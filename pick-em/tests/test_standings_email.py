"""Tests for send_standings_email.top_scorers() -- the guard deciding
whether a week is worth emailing the whole league about. Both None cases
are real failure modes that were hit (or newly reachable), not
hypotheticals, so they're pinned here.
"""
from send_standings_email import top_scorers


def _entry(name, points):
    return {"name": name, "points": points, "w": 0, "l": 0, "p": 0}


def test_returns_max_and_single_winner():
    weekly = {
        "u1": _entry("Alice", 14),
        "u2": _entry("Bob", 9),
    }
    assert top_scorers(weekly) == (14, ["Alice"])


def test_returns_every_tied_winner():
    """A tied week has multiple winners -- the email joins them with
    " & ", so all of them must come back.
    """
    weekly = {
        "u1": _entry("Alice", 14),
        "u2": _entry("Bob", 14),
        "u3": _entry("Carl", 3),
    }
    max_points, winners = top_scorers(weekly)
    assert max_points == 14
    assert sorted(winners) == ["Alice", "Bob"]


def test_none_when_no_scorable_entries():
    """compute_points() skips docs with no picks, so a non-empty
    week_docs can still reduce to {} by the time it reaches here. This
    used to reach `max()` on an empty sequence and raise ValueError,
    killing the send outright.
    """
    assert top_scorers({}) is None


def test_none_when_everyone_scored_zero():
    """Nothing graded yet. week_is_complete() consults ESPN directly,
    but results.json is written by a separate workflow that can lag, so
    a finished week can still have an empty results file -- which would
    otherwise email the league "the top score of the week (0 points)".
    """
    weekly = {
        "u1": _entry("Alice", 0),
        "u2": _entry("Bob", 0),
    }
    assert top_scorers(weekly) is None


def test_sends_when_only_one_player_scored_anything():
    """Guard against over-correcting: a single point is a real result and
    must still produce a winner.
    """
    weekly = {
        "u1": _entry("Alice", 1),
        "u2": _entry("Bob", 0),
    }
    assert top_scorers(weekly) == (1, ["Alice"])
