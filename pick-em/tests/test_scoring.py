"""Tests for pickem_common.grade_pick()/compute_points() -- the sole
scoring implementation (a port of record.js's client-side gradePick()).
A bug here silently mis-scores real games once the season starts, so
these lock in the exact grading/point-tally behavior.
"""
import json
from pathlib import Path

import pytest

from pickem_common import (
    compute_points,
    grade_pick,
    rank_standings,
    standings_sort_key,
)

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


# ---- Mismatched pick type / line (previously exploitable) ----

GAME = {
    "away_team": "Away",
    "home_team": "Home",
    "scores": {"Away": 10, "Home": 13},
}


@pytest.mark.parametrize("pick_value", ["Over|44.5", "Under|0", "Over|0"])
def test_grade_pick_over_under_value_under_spread_key_is_pending(pick_value):
    """Regression test for a forged-win exploit. firestore.rules used to
    accept any of the four legitimate values for either key prefix, so a
    player could store an Over/Under value under a spread_ key. This
    function then read "Under"/"Over" as a team name, took the
    not-the-away-team branch, and graded the HOME side with the total as
    a spread -- e.g. "Under|0" scored a guaranteed WIN (5 pts when
    locked). Neither side is a real selection for a spread pick, so the
    only correct answer is PENDING.
    """
    assert grade_pick(pick_value, "Spread", GAME) == "PENDING"


@pytest.mark.parametrize("pick_value", ["Away|-3", "Home|+3"])
def test_grade_pick_team_value_under_ou_key_is_pending(pick_value):
    """Mirror of the above: a team name stored under an ou_ key must not
    grade.
    """
    assert grade_pick(pick_value, "Over/Under", GAME) == "PENDING"


def test_grade_pick_team_value_under_ou_key_on_the_total_is_pending():
    """The quiet variant: line (23) == total (10 + 13), which used to
    short-circuit to PUSH before `selection` was ever inspected, scoring
    a point for a nonsense pick.
    """
    assert grade_pick("Away|23", "Over/Under", GAME) == "PENDING"


@pytest.mark.parametrize("pick_type", ["Spread", "Over/Under"])
def test_grade_pick_na_line_is_pending(pick_type):
    """Regression test: espn_api._format_spread()/_format_over_under()
    write the literal string "N/A" whenever ESPN has published no odds,
    and matchups.js used to render those as selectable radios. float("N/A")
    then raised ValueError here, which aborted update_leaderboard.py and
    send_standings_email.py outright -- one player's unpriced pick took
    down the entire league's standings. (The JS port diverged instead:
    parseFloat -> NaN -> fell through to PUSH, a free point.)
    """
    selection = "Away" if pick_type == "Spread" else "Over"
    assert grade_pick(f"{selection}|N/A", pick_type, GAME) == "PENDING"


@pytest.mark.parametrize("line_str", ["", "abc", "+", "N/A"])
def test_grade_pick_non_numeric_line_never_raises(line_str):
    """No line string, however malformed, may raise out of grade_pick() --
    compute_points() runs over every player's picks in one pass, so a
    single bad value must not be able to abort the whole run.
    """
    assert grade_pick(f"Away|{line_str}", "Spread", GAME) == "PENDING"
    assert grade_pick(f"Over|{line_str}", "Over/Under", GAME) == "PENDING"


def test_compute_points_skips_docs_with_no_picks():
    """An empty-picks doc must not produce a leaderboard row. The entry
    used to be seeded before the pick loop ran, so a junk doc at a
    fabricated week (e.g. "<uid>_week999_9999", creatable because
    allPicksOk() passes vacuously on an empty map) showed up as a
    0-point player. firestore.rules now bounds picks to 1..7, but
    update_leaderboard.py streams the whole collection, so any doc
    created before that bound existed still has to be ignored here.
    """
    docs = [
        {"userId": "real", "username": "Real", "picks": {"spread_g1": "Away|-3"}},
        {"userId": "junk", "username": "Junk", "picks": {}},
        {"userId": "also-junk", "username": "AlsoJunk"},          # no picks key
        {"userId": "null-junk", "username": "NullJunk", "picks": None},
    ]
    stats = compute_points(docs, {"g1": GAME})
    assert set(stats) == {"real"}


def test_compute_points_keeps_player_whose_picks_are_all_pending():
    """Guard against over-correcting the above: a player with real picks
    on games that haven't been graded yet still belongs on the
    leaderboard at 0 points. Only a doc with NO picks is skipped.
    """
    docs = [
        {"userId": "waiting", "username": "Waiting", "picks": {"spread_future": "Away|-3"}},
    ]
    stats = compute_points(docs, {})
    assert stats == {
        "waiting": {"name": "Waiting", "points": 0, "w": 0, "l": 0, "p": 0}
    }


def test_compute_points_ignores_forged_and_unpriced_picks():
    """compute_points() must survive and score 0 for a doc made entirely
    of picks that the old implementation either crashed on or awarded
    points for.
    """
    docs = [
        {
            "userId": "cheater",
            "username": "Cheater",
            "picks": {
                "spread_g1": "Under|0",     # forged: guaranteed WIN before
                "ou_g1": "Away|23",         # forged: PUSH before
                "spread_g2": "Away|N/A",    # unpriced: ValueError before
            },
            "lockedPick": "spread_g1",
        },
    ]
    stats = compute_points(docs, {"g1": GAME, "g2": GAME})
    assert stats == {
        "cheater": {"name": "Cheater", "points": 0, "w": 0, "l": 0, "p": 0}
    }


# ---- Standings order and shared ranks ----
#
# These cover the Python ports in pickem_common; compareStandings() /
# rankStandings() in grading.js must stay in sync, since record.js renders
# the same ranks as send_standings_email.py.


def _entry(name, points, w=0, l=0, p=0):
    return {"name": name, "points": points, "w": w, "l": l, "p": p}


def _ordered(entries):
    return [u["name"] for u in sorted(entries, key=standings_sort_key)]


def test_standings_sort_orders_by_points_desc():
    entries = [_entry("Low", 3), _entry("High", 20), _entry("Mid", 12)]
    assert _ordered(entries) == ["High", "Mid", "Low"]


def test_standings_sort_breaks_point_tie_by_more_wins():
    entries = [
        _entry("FewerWins", 12, w=2, l=0),
        _entry("MoreWins", 12, w=4, l=3),
    ]
    assert _ordered(entries) == ["MoreWins", "FewerWins"]


def test_standings_sort_breaks_win_tie_by_fewer_losses():
    entries = [
        _entry("MoreLosses", 12, w=4, l=5),
        _entry("FewerLosses", 12, w=4, l=1),
    ]
    assert _ordered(entries) == ["FewerLosses", "MoreLosses"]


def test_standings_sort_falls_back_to_name_for_full_tie():
    """Name is the last resort purely so a full tie has a stable display
    order -- without it the order fell out of dict enumeration and could
    shuffle between runs.
    """
    entries = [_entry("Zoe", 12, w=4, l=1), _entry("Alice", 12, w=4, l=1)]
    assert _ordered(entries) == ["Alice", "Zoe"]


def test_standings_sort_is_stable_regardless_of_input_order():
    entries = [
        _entry("Bob", 20, w=6, l=1),
        _entry("Alice", 12, w=4, l=1),
        _entry("Zoe", 12, w=4, l=1),
        _entry("Carl", 5, w=1, l=4),
    ]
    assert _ordered(entries) == _ordered(list(reversed(entries)))


def test_rank_standings_shares_a_rank_for_a_full_tie_and_skips_the_next():
    """Standard competition ranking ("1224"): players level on
    points/w/l share a rank, and the next distinct player skips the ranks
    that tie consumed.
    """
    entries = sorted(
        [
            _entry("Bob", 20, w=6, l=1),
            _entry("Alice", 12, w=4, l=1),
            _entry("Zoe", 12, w=4, l=1),
            _entry("Carl", 5, w=1, l=4),
        ],
        key=standings_sort_key,
    )
    ranked = [(rank, u["name"]) for rank, u in rank_standings(entries)]
    assert ranked == [(1, "Bob"), (2, "Alice"), (2, "Zoe"), (4, "Carl")]


def test_rank_standings_does_not_share_a_rank_when_only_points_match():
    """Equal points but different w/l is NOT a tie under these rules --
    the records differ, so the ranks must too.
    """
    entries = sorted(
        [_entry("MoreWins", 12, w=4, l=3), _entry("FewerWins", 12, w=2, l=0)],
        key=standings_sort_key,
    )
    ranked = [(rank, u["name"]) for rank, u in rank_standings(entries)]
    assert ranked == [(1, "MoreWins"), (2, "FewerWins")]


def test_rank_standings_ignores_name_when_deciding_a_tie():
    """Name only affects display order, never whether two players are
    tied -- otherwise no two players could ever share a rank.
    """
    entries = sorted(
        [_entry("Zoe", 12, w=4, l=1), _entry("Alice", 12, w=4, l=1)],
        key=standings_sort_key,
    )
    ranked = [(rank, u["name"]) for rank, u in rank_standings(entries)]
    assert ranked == [(1, "Alice"), (1, "Zoe")]


def test_rank_standings_three_way_tie_shares_one_rank():
    entries = sorted(
        [
            _entry("Ace", 30, w=10, l=0),
            _entry("Ann", 12, w=4, l=1),
            _entry("Ben", 12, w=4, l=1),
            _entry("Cal", 12, w=4, l=1),
            _entry("Dan", 2, w=0, l=9),
        ],
        key=standings_sort_key,
    )
    ranked = [(rank, u["name"]) for rank, u in rank_standings(entries)]
    assert ranked == [
        (1, "Ace"), (2, "Ann"), (2, "Ben"), (2, "Cal"), (5, "Dan")
    ]


def test_rank_standings_empty_list():
    assert rank_standings([]) == []
