"""Tests for espn_api.py's parsing of ESPN's undocumented scoreboard
endpoint. Fed entirely from recorded fixture JSON via a monkeypatched
_scoreboard() -- no network calls, deterministic, no rate-limit risk
against ESPN's endpoint. Each case below is tied to a real gotcha
already hit live: `odds` is `null` (not `[]`) for completed weeks, and
`score` fields are strings, not numbers.
"""
import json
from pathlib import Path

import espn_api

FIXTURES = Path(__file__).parent / "fixtures" / "espn"


def _load(name):
    with open(FIXTURES / name) as f:
        return json.load(f)


def _patch_scoreboard(monkeypatch, data):
    monkeypatch.setattr(espn_api, "_scoreboard", lambda **kwargs: data)


def test_week_games_upcoming_week_returns_all_games(monkeypatch):
    data = _load("upcoming_week.json")
    _patch_scoreboard(monkeypatch, data)

    games = espn_api.week_games(1, 2, 2026)

    assert len(games) == 16
    game = next(g for g in games if g["id"] == "401872923")
    assert game == {
        "id": "401872923",
        "away": "New Orleans Saints",
        "home": "Detroit Lions",
        "spread": "+7",
        "over_under": "50.5",
        "commence_time": "2026-09-13T17:00Z",
    }


def test_week_games_completed_week_handles_null_odds(monkeypatch):
    """Fixture's top-level odds is null/absent for every game in a
    fully-completed past week -- regression test for the
    `odds = competition.get("odds") or []` guard.
    """
    data = _load("completed_week.json")
    _patch_scoreboard(monkeypatch, data)

    games = espn_api.week_games(5, 2, 2025)

    assert len(games) == 14
    for game in games:
        assert game["spread"] == "N/A"
        assert game["over_under"] == "N/A"


def test_week_games_pk_line_normalizes_to_pk(monkeypatch):
    data = _load("pk_snippet.json")
    _patch_scoreboard(monkeypatch, data)

    games = espn_api.week_games(1, 2, 2026)

    assert len(games) == 1
    assert games[0]["spread"] == "PK"


def test_completed_scores_returns_int_scores_for_every_game(monkeypatch):
    """score is a JSON string in ESPN's response -- regression test that
    it comes back as an int.
    """
    data = _load("completed_week.json")
    _patch_scoreboard(monkeypatch, data)

    scores = espn_api.completed_scores(5, 2, 2025)

    assert len(scores) == 14
    for result in scores.values():
        away_score = result["scores"][result["away_team"]]
        home_score = result["scores"][result["home_team"]]
        assert isinstance(away_score, int)
        assert isinstance(home_score, int)

    saints_lions = scores["401772744"]
    assert saints_lions == {
        "away_team": "New York Giants",
        "home_team": "New Orleans Saints",
        "scores": {"New York Giants": 14, "New Orleans Saints": 26},
    }


def test_completed_scores_upcoming_week_excludes_unfinished_games(monkeypatch):
    """Fixture is mostly-scheduled with one already-final game (a real
    recorded snapshot) -- only that one finished game should come back,
    not the 15 still-scheduled ones.
    """
    data = _load("upcoming_week.json")
    _patch_scoreboard(monkeypatch, data)

    scores = espn_api.completed_scores(1, 2, 2026)

    assert scores == {
        "401872656": {
            "away_team": "New England Patriots",
            "home_team": "Seattle Seahawks",
            "scores": {"New England Patriots": 10, "Seattle Seahawks": 13},
        }
    }


def test_week_is_complete_true_for_fully_completed_week(monkeypatch):
    data = _load("completed_week.json")
    _patch_scoreboard(monkeypatch, data)

    assert espn_api.week_is_complete(5, 2, 2025) is True


def test_week_is_complete_false_for_upcoming_week(monkeypatch):
    data = _load("upcoming_week.json")
    _patch_scoreboard(monkeypatch, data)

    assert espn_api.week_is_complete(1, 2, 2026) is False


def test_week_is_complete_false_for_empty_week(monkeypatch):
    _patch_scoreboard(monkeypatch, {"events": []})

    assert espn_api.week_is_complete(22, 2, 2026) is False


def test_current_week_and_year_parses_top_level_block(monkeypatch):
    data = _load("upcoming_week.json")
    _patch_scoreboard(monkeypatch, data)

    assert espn_api.current_week_and_year() == (1, 2, 2026)
