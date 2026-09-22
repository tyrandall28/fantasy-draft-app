"""Per-IP rate limiting for the endpoints worth brute-forcing.

Login and register had no limit at all, which on a public deploy means an
attacker can try passwords as fast as the network allows. bcrypt makes each
attempt cost ~100ms of CPU, so this is also the cheapest way to turn the login
endpoint into a way of exhausting the container.

**Why not slowapi**, which TODO.md suggests: slowapi's default backend is an
in-process dictionary — exactly what this is — and only becomes distributed
when pointed at Redis, which this project has no reason to run yet. The
dependency would buy decorator syntax, not stronger limits. Worth revisiting if
this ever runs on more than one instance, where the right answer is a shared
store rather than either of these.

**What this does and does not stop.** It's per-instance and per-IP: it stops a
single host hammering one account, and does not stop a distributed attempt from
many addresses. Combined with the password floor in schemas/auth.py it makes
online guessing impractical; it is not a substitute for account lockout
(TODO.md) if that becomes a concern.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

# How many requests, over how many seconds, per IP per bucket.
#
# Login is the higher of the two because a real person fat-fingers a password
# several times in a row and should not be locked out of their own draft. Ten
# in fifteen minutes still caps an attacker at roughly 1,000 guesses a day,
# against which an 8-character letters-and-digits minimum holds up fine.
LOGIN_LIMIT = (10, 15 * 60)

# Register is tighter: nobody needs a second account a minute after their
# first, and this is the endpoint that writes rows.
REGISTER_LIMIT = (5, 60 * 60)

# Refresh used to share the login bucket, which conflated two different things.
# A login attempt is a guess at a password; a refresh presents a token this
# server already signed, so there is nothing to brute-force — the only thing
# worth capping is volume. Sharing meant a few mistyped passwords could use up
# a real session's refreshes, and the frontend treats a failed refresh as "log
# out", so the cost of getting this wrong is signing someone out mid-draft.
# One access token lasts 30 minutes, and every open tab refreshes its own, so
# this is set well above any honest use.
REFRESH_LIMIT = (60, 15 * 60)


class RateLimiter:
    """Sliding-window counter, keyed by bucket name and client address.

    A deque of timestamps per key. Sliding rather than fixed-window because a
    fixed window lets 2x the limit through across a boundary — 10 at 14:59 and
    10 more at 15:00.
    """

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self.enabled = True

    def check(self, bucket: str, client: str, limit: int, window_seconds: int) -> int | None:
        """Record a hit. Returns None if allowed, or seconds to wait if not."""
        if not self.enabled:
            return None

        now = time.monotonic()
        hits = self._hits[(bucket, client)]

        # Drop everything that has aged out of the window. This is also what
        # keeps memory bounded for a key that stops being used — plus the
        # sweep below for keys that go quiet entirely.
        cutoff = now - window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()

        if len(hits) >= limit:
            return max(1, int(hits[0] + window_seconds - now) + 1)

        hits.append(now)
        self._maybe_sweep(now, window_seconds)
        return None

    def _maybe_sweep(self, now: float, window_seconds: int) -> None:
        """Discard keys with no hits left, so a botnet can't grow this forever.

        Only runs once the map is large, since the common case is a handful of
        addresses and walking it on every request would be waste.
        """
        if len(self._hits) < 1_000:
            return
        cutoff = now - window_seconds
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
            del self._hits[key]

    def reset(self) -> None:
        """Clear all state. Used between tests."""
        self._hits.clear()


limiter = RateLimiter()


def client_key(request: Request) -> str:
    """The caller's address, as well as it can be known.

    Behind Cloud Run `request.client.host` is Google's front end, identical for
    every caller, which would make one global limit for the whole internet.
    The real address is the *first* entry in X-Forwarded-For; later entries are
    proxies, and a client-supplied header would be appended after the real one
    rather than replacing it.

    A caller can still spoof the first entry when nothing trustworthy sets the
    header, so this is not an identity — it's a bucket key that makes naive
    brute force expensive.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _enforce(request: Request, bucket: str, limit: tuple[int, int]) -> None:
    count, window = limit
    retry_after = limiter.check(bucket, client_key(request), count, window)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )


def limit_login(request: Request) -> None:
    """FastAPI dependency: rate-limits login attempts."""
    _enforce(request, "login", LOGIN_LIMIT)


def limit_register(request: Request) -> None:
    """FastAPI dependency: rate-limits account creation."""
    _enforce(request, "register", REGISTER_LIMIT)


def limit_refresh(request: Request) -> None:
    """FastAPI dependency: caps token refreshes, in their own bucket."""
    _enforce(request, "refresh", REFRESH_LIMIT)
