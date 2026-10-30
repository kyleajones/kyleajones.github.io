import json
import os
from datetime import datetime, timezone

from pickem_common import firestore_client, weeks_to_recheck


def revealed_lock(locked_pick, revealed_picks):
    """The player's lockedPick, but ONLY once the pick it designates has
    itself been revealed (i.e. that game has kicked off). Returns None
    otherwise.

    This gate is the whole point. `lockedPick` is a pick key like
    "spread_<gameId>", so publishing it unredacted would tell every other
    player which game a rival has picked -- and that it's their lock --
    while that game hasn't started yet. That's exactly the information
    `revealed_picks` exists to withhold, so leaking it via the lock field
    would quietly undo the redaction next to it.

    Keying off membership in `revealed_picks` is the precise condition:
    if the underlying pick is already public, naming it as the lock adds
    nothing that kickoff hasn't already made public.
    """
    if not locked_pick:
        return None
    return locked_pick if locked_pick in revealed_picks else None


def compute_week_board(db, week, year):
    """Writes a public, pre-redacted mirror of everyone's picks for one
    week to `weeklyPicks/{year}_week{week}`, via the Admin SDK (bypasses
    firestore.rules). A pick is only included once its game's kickoff
    (from the `matchups` mirror) has passed -- clients never see another
    player's picks for a game that hasn't started, since this is the only
    place that data is ever exposed beyond the owning player's own doc.

    `lockedPick` is published under the same rule, via revealed_lock():
    it only appears once the pick it points at has itself been revealed.
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
            "lockedPick": revealed_lock(record.get("lockedPick"), revealed_picks),
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

    for w in weeks_to_recheck(week):
        compute_week_board(db, w, year)
        print(f"Updated weeklyPicks board for week {w}, {year}.")


if __name__ == "__main__":
    update_weekly_picks()
