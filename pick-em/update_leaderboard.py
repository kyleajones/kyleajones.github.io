import json
import os
from datetime import datetime, timezone

from pickem_common import compute_points, firestore_client


def update_leaderboard():
    """Pre-computes the season leaderboard aggregate server-side and
    writes it to a single trusted mirror doc (`leaderboard/current`),
    the same pattern `update_picks.py`'s mirror_matchups_to_firestore()
    uses for `/matchups`. This lets record.js render the public
    leaderboard from one getDoc() instead of an unfiltered scan over
    every player's `/picks` docs, which firestore.rules now denies.

    Player entries are nested under a `players` key alongside a
    `computedAt` timestamp -- the same doc shape update_weekly_picks.py
    already writes for `weeklyPicks`. record.js surfaces that timestamp,
    since this only runs once daily (update-scores.yml, 07:30 UTC) off
    results.json, while the Results tab polls ESPN live: a player
    comparing the two mid-week would otherwise see live-graded badges
    that silently disagree with their leaderboard points, with nothing
    on the page explaining why.
    """
    cred_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not cred_json:
        print("FIREBASE_SERVICE_ACCOUNT_JSON not set; skipping Firestore leaderboard mirror.")
        return

    db = firestore_client(cred_json)

    with open("results.json") as f:
        results_data = json.load(f)

    docs = [doc.to_dict() for doc in db.collection("picks").stream()]
    user_stats = compute_points(docs, results_data)

    db.collection("leaderboard").document("current").set({
        "players": user_stats,
        "computedAt": datetime.now(timezone.utc),
    })


if __name__ == "__main__":
    update_leaderboard()
