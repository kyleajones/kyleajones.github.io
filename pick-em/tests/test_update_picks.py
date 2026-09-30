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
