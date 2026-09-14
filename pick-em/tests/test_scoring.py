"""Tests for pickem_common.grade_pick()/compute_points() -- the sole
scoring implementation (a port of record.js's client-side gradePick()).
A bug here silently mis-scores real games once the season starts, so
these lock in the exact grading/point-tally behavior.
"""
import json
from pathlib import Path

import pytest

from pickem_common import compute_points, grade_pick

FIXTURES = Path(__file__).parent / "fixtures"


def test_compute_points_matches_expected_final_standings():
    """End-to-end: realistic picks docs (2 users) graded against a
    results fixture. One win is locked (5 pts), one win is unlocked (3
    pts), a push (1 pt regardless of lock), a loss (0 pts), and a pick
    on a game with no reported result yet (pending -- no effect at
    all). Doubles as living documentation of the picks-doc data model.
    """
    with open(FIXTURES / "results_sample.json") as f:
        results = json.load(f)
    with open(FIXTURES / "picks_docs_sample.json") as f:
        docs = json.load(f)

    stats = compute_points(docs, results)

    assert stats == {
        "uidA": {"name": "Alice", "points": 6, "w": 1, "l": 1, "p": 1},
        "uidB": {"name": "Bob", "points": 4, "w": 1, "l": 1, "p": 1},
    }


def test_locked_win_scores_five_unlocked_win_scores_three():
    game_result = {
        "away_team": "Away Team",
        "home_team": "Home Team",
        "scores": {"Away Team": 20, "Home Team": 10},
    }
    docs = [
        {
            "userId": "locked-winner",
            "username": "Locked",
            "picks": {"spread_g1": "Away Team|-3"},
            "lockedPick": "spread_g1",
        },
        {
            "userId": "unlocked-winner",
            "username": "Unlocked",
            "picks": {"spread_g1": "Away Team|-3"},
            "lockedPick": None,
        },
    ]
    stats = compute_points(docs, {"g1": game_result})
    assert stats["locked-winner"]["points"] == 5
    assert stats["unlocked-winner"]["points"] == 3
    assert stats["locked-winner"]["w"] == stats["unlocked-winner"]["w"] == 1


def test_push_and_loss_unaffected_by_lock():
    """A lock only boosts a WIN. Locking a pick that pushes or loses
    must not grant any bonus points.
    """
    push_result = {
        "away_team": "Away Team",
        "home_team": "Home Team",
        "scores": {"Away Team": 20, "Home Team": 17},
    }
    loss_result = {
        "away_team": "Away Team",
        "home_team": "Home Team",
        "scores": {"Away Team": 0, "Home Team": 30},
    }
    docs = [
        {
            "userId": "u1",
            "username": "U1",
            "picks": {
                "spread_push": "Away Team|-3",
                "spread_loss": "Away Team|-3",
            },
            "lockedPick": "spread_push",
        },
    ]
    stats = compute_points(docs, {"push": push_result, "loss": loss_result})
    assert stats["u1"] == {"name": "U1", "points": 1, "w": 0, "l": 1, "p": 1}


@pytest.mark.parametrize(
    "away_score,home_score,pick_value",
    [
        # Home favored by -3, wins by exactly 3: adjusted == opponent -> PUSH.
        (17, 20, "Home|-3"),
        # Away getting +3, loses by exactly 3: adjusted == opponent -> PUSH.
        (17, 20, "Away|+3"),
    ],
)
def test_grade_pick_spread_push_on_the_line(away_score, home_score, pick_value):
    game_result = {
        "away_team": "Away",
        "home_team": "Home",
        "scores": {"Away": away_score, "Home": home_score},
    }
    assert grade_pick(pick_value, "Spread", game_result) == "PUSH"


@pytest.mark.parametrize(
    "selection,away_score,home_score,expected",
    [
        ("Away", 17, 14, "WIN"),   # away favored by "PK" line, wins outright
        ("Home", 17, 14, "LOSS"),  # home picked, PK line, loses outright
        ("Away", 14, 14, "PUSH"),  # PK line, tie game
    ],
)
def test_grade_pick_pk_line(selection, away_score, home_score, expected):
    game_result = {
        "away_team": "Away",
        "home_team": "Home",
        "scores": {"Away": away_score, "Home": home_score},
    }
    assert grade_pick(f"{selection}|PK", "Spread", game_result) == expected


def test_grade_pick_over_under_exact_tie_is_push():
    game_result = {
        "away_team": "Away",
        "home_team": "Home",
        "scores": {"Away": 20, "Home": 23},
    }
    assert grade_pick("Over|43", "Over/Under", game_result) == "PUSH"
    assert grade_pick("Under|43", "Over/Under", game_result) == "PUSH"


def test_grade_pick_missing_team_in_scores_is_pending():
    """Game partially reported (one score not in yet)."""
    game_result = {
        "away_team": "Away",
        "home_team": "Home",
        "scores": {"Away": 10},
    }
    assert grade_pick("Away|-3", "Spread", game_result) == "PENDING"


def test_grade_pick_no_game_result_is_pending():
    assert grade_pick("Away|-3", "Spread", None) == "PENDING"
    assert grade_pick("Away|-3", "Spread", {}) == "PENDING"
