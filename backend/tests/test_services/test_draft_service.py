"""Unit tests for the pure helpers in draft_service.

Bot-pick integration (DB-touching) is exercised via the API tests; these
tests focus on the in-memory roster-need logic that was added to make the
bot draft positionally-aware.
"""
import random

import pytest

from app.services.draft_service import (
    BOT_VARIANCE_TOP_N,
    compute_open_slots,
    is_position_needed,
    pick_with_variance,
)


STANDARD_SLOTS = {
    "QB": 1, "RB": 2, "WR": 2, "TE": 1,
    "FLEX": 1, "K": 1, "DST": 1, "BN": 6,
}


class TestComputeOpenSlots:
    def test_no_picks_yet(self):
        by_pos, flex = compute_open_slots([], STANDARD_SLOTS)
        assert by_pos == {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "K": 1, "DST": 1}
        assert flex == 1

    def test_dedicated_slot_consumed_before_flex(self):
        # Two RBs fit in dedicated RB slots; FLEX stays open.
        by_pos, flex = compute_open_slots(["RB", "RB"], STANDARD_SLOTS)
        assert by_pos["RB"] == 0
        assert flex == 1

    def test_flex_overflow(self):
        # 3rd RB has nowhere to go but FLEX.
        by_pos, flex = compute_open_slots(["RB", "RB", "RB"], STANDARD_SLOTS)
        assert by_pos["RB"] == 0
        assert flex == 0

    def test_bench_overflow_is_silent(self):
        # 4 RBs: 2 dedicated, 1 FLEX, 1 bench — bench doesn't affect open count.
        by_pos, flex = compute_open_slots(["RB"] * 4, STANDARD_SLOTS)
        assert by_pos["RB"] == 0
        assert flex == 0  # already zero, the 4th is bench

    def test_mixed_positions(self):
        picks = ["QB", "RB", "WR", "WR", "TE", "RB"]
        by_pos, flex = compute_open_slots(picks, STANDARD_SLOTS)
        assert by_pos == {"QB": 0, "RB": 0, "WR": 0, "TE": 0, "K": 1, "DST": 1}
        assert flex == 1  # nothing's overflowed into FLEX yet

    def test_unknown_position_safely_lands_on_bench(self):
        by_pos, flex = compute_open_slots(["LB"], STANDARD_SLOTS)  # not a real position
        assert by_pos == {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "K": 1, "DST": 1}
        assert flex == 1


class TestIsPositionNeeded:
    def test_open_dedicated_slot(self):
        by_pos = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "K": 1, "DST": 1}
        assert is_position_needed("RB", by_pos, flex_open=1) is True

    def test_filled_dedicated_but_flex_open_for_skill(self):
        by_pos = {"QB": 1, "RB": 0, "WR": 2, "TE": 1, "K": 1, "DST": 1}
        assert is_position_needed("RB", by_pos, flex_open=1) is True

    def test_filled_dedicated_and_no_flex(self):
        by_pos = {"QB": 1, "RB": 0, "WR": 2, "TE": 1, "K": 1, "DST": 1}
        assert is_position_needed("RB", by_pos, flex_open=0) is False

    def test_no_kicker_when_many_starters_open(self):
        # 4 other starter slots still open → K should not be picked yet.
        by_pos = {"QB": 1, "RB": 1, "WR": 1, "TE": 0, "K": 1, "DST": 0}
        assert is_position_needed("K", by_pos, flex_open=1) is False

    def test_kicker_allowed_when_few_starters_left(self):
        # Only 1 other starter slot open → K is now fair game.
        by_pos = {"QB": 0, "RB": 0, "WR": 0, "TE": 1, "K": 1, "DST": 0}
        assert is_position_needed("K", by_pos, flex_open=0) is True

    def test_dst_same_rule_as_k(self):
        by_pos = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "K": 0, "DST": 1}
        assert is_position_needed("DST", by_pos, flex_open=1) is False

    def test_anything_goes_when_all_starters_filled(self):
        # Starters all filled → bench picks are fine, even another RB.
        by_pos = {"QB": 0, "RB": 0, "WR": 0, "TE": 0, "K": 0, "DST": 0}
        assert is_position_needed("RB", by_pos, flex_open=0) is True
        assert is_position_needed("QB", by_pos, flex_open=0) is True
        assert is_position_needed("K", by_pos, flex_open=0) is True

    def test_no_eight_wrs_regression(self):
        # Simulate a bot that already has 4 WRs (2 dedicated + 1 FLEX + 1 bench).
        # A 5th WR is starters-already-full territory; the rule lets it through
        # because every starter slot is filled. The regression we care about is
        # the EARLY-round version: WR3 while RB and TE still wide open.
        by_pos, flex = compute_open_slots(["WR", "WR", "WR"], STANDARD_SLOTS)
        # WR dedicated full, FLEX full → 4th WR not needed (RB/TE/etc open).
        assert is_position_needed("WR", by_pos, flex) is False

    def test_no_back_to_back_te_regression(self):
        # 1 TE drafted → TE dedicated slot filled, FLEX still open.
        # Bots should NOT take a 2nd TE for FLEX — TE depth is dead weight.
        by_pos, flex = compute_open_slots(["TE"], STANDARD_SLOTS)
        assert by_pos["TE"] == 0
        assert flex == 1
        assert is_position_needed("TE", by_pos, flex) is False
        # But RB / WR are still fine for FLEX
        assert is_position_needed("RB", by_pos, flex) is True
        assert is_position_needed("WR", by_pos, flex) is True


class TestPickWithVariance:
    def test_empty_raises(self):
        with pytest.raises(ValueError):
            pick_with_variance([])

    def test_single_candidate_always_picked(self):
        random.seed(0)
        assert pick_with_variance([42]) == 42

    def test_pick_is_within_top_n(self):
        random.seed(0)
        candidates = list(range(1, 11))
        for _ in range(50):
            pick = pick_with_variance(candidates)
            assert pick in candidates[:BOT_VARIANCE_TOP_N]

    def test_top_candidate_wins_most_often(self):
        random.seed(123)
        candidates = [1, 2, 3]
        counts = {1: 0, 2: 0, 3: 0}
        for _ in range(2000):
            counts[pick_with_variance(candidates)] += 1
        # Weights are (0.6, 0.3, 0.1) — give wide tolerance for randomness.
        assert counts[1] > counts[2] > counts[3]
        assert counts[1] > 1000  # ~1200 expected
        assert counts[3] < 400   # ~200 expected
