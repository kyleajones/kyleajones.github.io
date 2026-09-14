"""Hits the real, undocumented ESPN scoreboard endpoint to catch
schema drift before it silently breaks matchups.json/results.json in
production. No SLA on this endpoint, so this is opt-in only: skipped
by default (see pytest.ini's `addopts = -m "not live"`), run manually
with `pytest -m live` before trusting a change.
"""
import pytest

import espn_api


@pytest.mark.live
def test_scoreboard_top_level_shape_has_not_drifted():
    data = espn_api._scoreboard()

    assert "week" in data
    assert "season" in data
    assert "events" in data

    events = data["events"]
    assert len(events) > 0

    event = events[0]
    assert "id" in event
    assert "competitions" in event
    assert "competitors" in event["competitions"][0]
