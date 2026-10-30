"""Tests for update_weekly_picks.py's redaction.

`weeklyPicks/{year}_week{n}` is the ONLY place one player's picks are
ever exposed to another, so everything published here has to be gated on
kickoff. These pin that gate for both the picks themselves and the
lockedPick field.
"""
from update_weekly_picks import revealed_lock


def test_lock_is_published_once_its_pick_is_revealed():
    revealed = {"spread_started": "Team A|+3", "ou_started": "Over|44.5"}
    assert revealed_lock("spread_started", revealed) == "spread_started"


def test_lock_is_withheld_while_its_game_has_not_started():
    """The leak this gate exists to prevent. lockedPick is a pick key
    ("spread_<gameId>"), so publishing it unredacted would tell everyone
    which game a rival picked -- and that it's their lock -- before that
    game kicks off, which is exactly what the picks redaction withholds.
    """
    revealed = {"spread_started": "Team A|+3"}
    assert revealed_lock("spread_future", revealed) is None


def test_lock_withheld_when_nothing_is_revealed_yet():
    assert revealed_lock("spread_future", {}) is None


def test_no_lock_set_is_none():
    assert revealed_lock(None, {"spread_started": "Team A|+3"}) is None
    assert revealed_lock("", {"spread_started": "Team A|+3"}) is None


def test_lock_on_an_over_under_key_is_handled_the_same():
    """A lock can designate either pick type -- the gate is membership in
    the revealed set, not the key's prefix.
    """
    revealed = {"ou_started": "Under|41"}
    assert revealed_lock("ou_started", revealed) == "ou_started"
    assert revealed_lock("ou_future", revealed) is None
