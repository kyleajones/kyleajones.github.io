"""Tests for update_picks.py's spread-line computation. compute_lines() is
a Python port of matchups.js's client-side spread math, kept in sync by
hand -- these pin down the shapes it actually receives from
matchups.json in production (including "PK", not a numeric "0", for a
pick'em line -- see espn_api._format_spread()).
"""
import update_picks as up


def test_compute_lines_na_passes_through():
    assert up.compute_lines("N/A") == ("N/A", "N/A")


def test_compute_lines_pk_passes_through():
    """Regression test: matchups.json's spread field is already the
    literal string "PK" for a pick'em game (never a numeric "0"), and
    compute_lines() used to call float("PK") unguarded, raising
    ValueError and aborting mirror_matchups_to_firestore()'s entire loop
    for any week containing a pick'em line.
    """
    assert up.compute_lines("PK") == ("PK", "PK")


def test_compute_lines_favors_home_side_for_negative_away_spread():
    assert up.compute_lines("-3.5") == ("-3.5", "+3.5")


def test_compute_lines_favors_away_side_for_positive_away_spread():
    assert up.compute_lines("+7") == ("+7", "-7")


def test_compute_lines_home_line_has_no_trailing_zero():
    assert up.compute_lines("-7") == ("-7", "+7")


# ---- valid_picks_map ----
#
# This is now the SOURCE OF TRUTH firestore.rules validates incoming
# picks against (`value in matchup.data.validPicks[prefix]`), after
# rebuilding those strings inline in the rules blew Firestore's
# 1000-expression-per-evaluation limit on a 7-pick update. A wrong value
# here doesn't just mis-validate -- it silently makes a legitimate pick
# unsaveable, so the exact strings are pinned.


def test_valid_picks_map_lists_both_sides_and_both_totals():
    away_line, home_line = up.compute_lines("+3")
    assert up.valid_picks_map("Team A", "Team B", away_line, home_line, "44.5") == {
        "spread": ["Team A|+3", "Team B|-3"],
        "ou": ["Over|44.5", "Under|44.5"],
    }


def test_valid_picks_map_pk_line_uses_pk_on_both_sides():
    """A pick'em game stores "PK" for both teams, not "+0"/"-0" -- the
    value a legitimate client-side selection actually produces.
    """
    away_line, home_line = up.compute_lines("PK")
    assert up.valid_picks_map("Team A", "Team B", away_line, home_line, "41")["spread"] == [
        "Team A|PK",
        "Team B|PK",
    ]


def test_valid_picks_map_unpriced_spread_is_empty_but_total_still_pickable():
    """The two sides are independent: ESPN often publishes a total with
    no spread. An empty list makes `value in []` false in the rules, so
    nothing is storable on that side -- while the priced side stays
    fully pickable.
    """
    result = up.valid_picks_map("Team G", "Team H", "N/A", "N/A", "44.5")
    assert result["spread"] == []
    assert result["ou"] == ["Over|44.5", "Under|44.5"]


def test_valid_picks_map_fully_unpriced_game_has_nothing_pickable():
    assert up.valid_picks_map("Team G", "Team H", "N/A", "N/A", "N/A") == {
        "spread": [],
        "ou": [],
    }


def test_valid_picks_map_keys_match_pick_key_prefixes():
    """The rules look up validPicks[key.split('_')[0]], so these keys
    must be exactly the prefixes used in stored pick keys
    ("spread_<id>" / "ou_<id>").
    """
    result = up.valid_picks_map("Team A", "Team B", "+3", "-3", "44.5")
    assert set(result) == {"spread", "ou"}
