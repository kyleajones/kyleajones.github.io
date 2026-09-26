import json
import os
from datetime import datetime, timezone

from pickem_common import firestore_client


def compute_week_board(db, week, year):
    """Writes a public, pre-redacted mirror of everyone's picks for one
    week to `weeklyPicks/{year}_week{week}`, via the Admin SDK (bypasses
    firestore.rules). A pick is only included once its game's kickoff
    (from the `matchups` mirror) has passed -- clients never see another
    player's picks for a game that hasn't started, since this is the only
    place that data is ever exposed beyond the owning player's own doc.
    """
    week_str = f"week{week}"
    year_str = str(year)

    commence_times = {}
    matchup_docs = (
        db.collection("matchups")
        .where("weekStr", "==", week_str)
        .where("yearStr", "==", year_str)
        .stream()
    )
    for matchup_doc in matchup_docs:
        commence_times[matchup_doc.id] = matchup_doc.to_dict()["commenceTime"]

    now = datetime.now(timezone.utc)

    players = {}
    picks_query = db.collection("picks").where("week", "==", week).where("year", "==", year)
    for pick_doc in picks_query.stream():
        record = pick_doc.to_dict()
        uid = record.get("userId")
        if not uid:
            continue

        revealed_picks = {}
        for pick_key, pick_value in (record.get("picks") or {}).items():
            game_id = pick_key.split("_")[1]
            commence_time = commence_times.get(game_id)
            if commence_time is not None and commence_time <= now:
                revealed_picks[pick_key] = pick_value

        players[uid] = {
            "username": record.get("username") or "Anonymous",
            "picks": revealed_picks,
        }

    db.collection("weeklyPicks").document(f"{year_str}_{week_str}").set({
        "players": players,
        "computedAt": now,
    })


def update_weekly_picks():
    cred_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not cred_json:
        print("FIREBASE_SERVICE_ACCOUNT_JSON not set; skipping weekly picks board.")
        return

    with open("current_week.json") as f:
        current_week = json.load(f)

    week = current_week["week"]
    year = current_week["year"]

    db = firestore_client(cred_json)

    # Recompute the current week and the one before it -- same rationale
    # as fetch_scores.py's weeks_to_check: catches a Monday-nighter that
    # started right at/after this week's rollover.
    weeks_to_compute = [week]
    if week > 1:
        weeks_to_compute.append(week - 1)

    for w in weeks_to_compute:
        compute_week_board(db, w, year)
        print(f"Updated weeklyPicks board for week {w}, {year}.")


if __name__ == "__main__":
    update_weekly_picks()
