const BASE_URL = "";

function getAccessToken(): string | null {
  return localStorage.getItem("access_token");
}

function getRefreshToken(): string | null {
  return localStorage.getItem("refresh_token");
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("access_token", access);
  localStorage.setItem("refresh_token", refresh);
}

export function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

export async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });

  if (!res.ok) {
    clearTokens();
    return null;
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

/** Return a valid access token, refreshing if the current one is expired. */
export async function getValidAccessToken(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;

  // Decode JWT payload to check expiry
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresAt = payload.exp * 1000; // ms
    if (Date.now() < expiresAt - 30_000) {
      // Token still valid (with 30s buffer)
      return token;
    }
  } catch {
    // Can't decode — try refresh
  }

  return refreshAccessToken();
}

/** One entry from FastAPI's 422 body, which is a list rather than a string. */
type ValidationIssue = {
  type?: string;
  loc?: (string | number)[];
  msg?: string;
  ctx?: Record<string, unknown>;
};

// Field names as they should read in a sentence. Anything absent falls back to
// the raw key, so a new field degrades to "avatar_url is required." rather
// than breaking.
const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  username: "Username",
  password: "Password",
  refresh_token: "Session",
  name: "Name",
  invite_code: "Invite code",
};

function fieldLabel(loc: (string | number)[] | undefined): string {
  // loc is ["body", "password"] — the last string entry is the field itself.
  const key = [...(loc ?? [])].reverse().find((p) => typeof p === "string" && p !== "body");
  if (typeof key !== "string") return "This field";
  return FIELD_LABELS[key] ?? key;
}

/**
 * Turn one pydantic issue into a sentence.
 *
 * The backend's own `field_validator`s already raise readable text ("Password
 * must contain at least one letter and one number."), but pydantic prefixes
 * those with "Value error, ". The built-in `Field(min_length=...)` constraints
 * fire *before* those validators, so their robotic phrasing is what a user
 * actually hits first — that pair is why registration showed "[object Object]".
 */
function describeIssue(issue: ValidationIssue | string): string {
  // Not a shape FastAPI produces, but a bare string in the list should still
  // reach the user rather than being flattened to "[object Object]" again.
  if (typeof issue === "string") return issue;

  const label = fieldLabel(issue.loc);
  const raw = issue.msg ?? "";

  switch (issue.type) {
    case "value_error":
      // Already human and already punctuated — just drop pydantic's prefix.
      return raw.replace(/^Value error,\s*/, "");
    case "missing":
      return `${label} is required.`;
    case "string_too_short": {
      const min = issue.ctx?.min_length;
      return min === undefined
        ? `${label} is too short.`
        : `${label} must be at least ${min} characters.`;
    }
    case "string_too_long": {
      const max = issue.ctx?.max_length;
      return max === undefined
        ? `${label} is too long.`
        : `${label} must be at most ${max} characters.`;
    }
    default:
      return raw ? `${label}: ${raw}` : `${label} is invalid.`;
  }
}

/**
 * Normalise an error body into a single displayable string.
 *
 * `detail` is a plain string for HTTPException (401, 409, the rate limiter)
 * but a list of objects for a 422. Passing the list straight to `new Error`
 * stringified it to "[object Object]".
 */
export function formatApiError(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;

  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail) return detail;

  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail.map((issue) => describeIssue(issue as ValidationIssue | string));
    // Deduplicate: two constraints on one field can otherwise say the same
    // thing twice.
    return [...new Set(messages)].join("\n");
  }

  return fallback;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatApiError(body, res.statusText || "Request failed"));
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
