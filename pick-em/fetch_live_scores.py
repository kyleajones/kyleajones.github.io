import json
import os
from datetime import datetime, timezone

from espn_api import live_scores
from pickem_common import firestore_client, weeks_to_recheck


def update_live_scores():
    """Writes a Firestore mirror of in-progress/completed scores for the
    current week (and the one before it, same rollover rationale as
    fetch_scores.py) to `liveScores/{year}_week{week}`, via the Admin SDK.
    Runs on a much tighter cadence than fetch_scores.py's daily
    results.json commit, since it never touches a tracked file -- no git
    commit/Pages rebuild involved. Does not touch results.json or the
    season leaderboard; those stay on the once-daily cadence.

    Each week is fetched/written independently, and a failure on one
    (e.g. a transient ESPN hiccup) is logged and skipped rather than
    aborting the run -- this fires every 15 minutes during game windows,
    so one bad week shouldn't also cost the other week its update for
    that cycle.
    """
    cred_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not cred_json:
        print("FIREBASE_SERVICE_ACCOUNT_JSON not set; skipping live scores mirror.")
        return

    with open("current_week.json") as f:
        current_week = json.load(f)

    week = current_week["week"]
    season_type = current_week["season_type"]
    year = current_week["year"]

    db = firestore_client(cred_json)
    now = datetime.now(timezone.utc)

    for w in weeks_to_recheck(week):
        try:
            games = live_scores(w, season_type, year)
            db.collection("liveScores").document(f"{year}_week{w}").set({
                "games": games,
                "updatedAt": now,
            })
            print(f"Updated liveScores for week {w}, {year}: {len(games)} games.")
        except Exception as e:
            print(f"Skipping liveScores update for week {w}, {year}: {e}")


if __name__ == "__main__":
    update_live_scores()
