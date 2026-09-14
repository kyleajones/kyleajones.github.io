"""Tests for migrate_game_ids.py -- the one-time Odds-API-ID -> ESPN-ID
migration. Cheap to test, real blast radius if it's ever run again
(it writes directly via the Admin SDK, bypassing firestore.rules).
"""
import json

import pytest

import migrate_game_ids as m


def _write_matchups_json(tmp_path, games):
    with open(tmp_path / "matchups.json", "w") as f:
        json.dump(games, f)


def test_build_id_map_joins_on_exact_team_pairs(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _write_matchups_json(tmp_path, [
        {"id": "old1", "away": "Team A", "home": "Team B"},
        {"id": "old2", "away": "Team C", "home": "Team D"},
    ])
    monkeypatch.setattr(m, "current_week_and_year", lambda: (1, 2, 2026))
    monkeypatch.setattr(m, "week_games", lambda week, season_type, year: [
        {"id": "new1", "away": "Team A", "home": "Team B"},
        {"id": "new2", "away": "Team C", "home": "Team D"},
    ])

    id_map, week, year = m.build_id_map()

    assert id_map == {"old1": "new1", "old2": "new2"}
    assert (week, year) == (1, 2026)


def test_build_id_map_raises_loudly_on_one_sided_mismatch(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _write_matchups_json(tmp_path, [
        {"id": "old1", "away": "Team A", "home": "Team B"},
        {"id": "old2", "away": "Team E", "home": "Team F"},  # only in old
    ])
    monkeypatch.setattr(m, "current_week_and_year", lambda: (1, 2, 2026))
    monkeypatch.setattr(m, "week_games", lambda week, season_type, year: [
        {"id": "new1", "away": "Team A", "home": "Team B"},
        {"id": "new2", "away": "Team C", "home": "Team D"},  # only in new
    ])

    with pytest.raises(SystemExit) as exc_info:
        m.build_id_map()

    message = str(exc_info.value)
    assert "Team E" in message and "Team F" in message
    assert "Team C" in message and "Team D" in message


def test_rename_picks_keys_only_renames_matching_key():
    picks = {"spread_old1": "Team A|-3", "ou_old2": "Over|44.5"}
    id_map = {"old1": "new1"}

    result = m.rename_picks_keys(picks, id_map)

    assert result == {"spread_new1": "Team A|-3", "ou_old2": "Over|44.5"}


def test_rename_picks_keys_returns_none_when_nothing_matches():
    picks = {"spread_old2": "Team A|-3"}
    id_map = {"old1": "new1"}

    assert m.rename_picks_keys(picks, id_map) is None


def test_renamed_locked_pick_matching_key():
    assert m.renamed_locked_pick("spread_old1", {"old1": "new1"}) == "spread_new1"


def test_renamed_locked_pick_non_matching_key_untouched():
    assert m.renamed_locked_pick("spread_old2", {"old1": "new1"}) == "spread_old2"


def test_renamed_locked_pick_none_input():
    assert m.renamed_locked_pick(None, {"old1": "new1"}) is None
