import argparse
import json
import os

from espn_api import current_week_and_year, week_games
from pickem_common import firestore_client


def build_id_map():
    """Joins the pre-migration matchups.json (Odds-API-ID-keyed) against
    ESPN's schedule for the same week on (away, home) team name pairs,
    to build {old_id: new_id}. Hard-fails if either side has a team pair
    the other doesn't -- this join must be exact, never a guess.
    """
    with open("matchups.json") as f:
        old_matchups = json.load(f)
    old_by_teams = {(g["away"], g["home"]): g["id"] for g in old_matchups}

    week, season_type, year = current_week_and_year()
    new_games = week_games(week, season_type, year)
    new_by_teams = {(g["away"], g["home"]): g["id"] for g in new_games}

    old_only = old_by_teams.keys() - new_by_teams.keys()
    new_only = new_by_teams.keys() - old_by_teams.keys()
    if old_only or new_only:
        raise SystemExit(
            "Team-pair mismatch between old matchups.json and ESPN's schedule "
            "-- refusing to guess.\n"
            f"Only in old matchups.json: {sorted(old_only)}\n"
            f"Only in ESPN's schedule: {sorted(new_only)}"
        )

    id_map = {old_by_teams[teams]: new_by_teams[teams] for teams in old_by_teams}
    return id_map, week, year


def rename_picks_keys(picks, id_map):
    """Returns a new `picks` dict with any spread_<oldId>/ou_<oldId> key
    renamed to use the new ID -- values and any non-matching keys are
    left untouched. Returns None if nothing in this doc needs renaming.
    """
    renamed = {}
    changed = False
    for key, value in picks.items():
        prefix, _, old_id = key.partition("_")
        new_id = id_map.get(old_id)
        if new_id is not None:
            renamed[f"{prefix}_{new_id}"] = value
            changed = True
        else:
            renamed[key] = value
    return renamed if changed else None


def renamed_locked_pick(locked_pick, id_map):
    if not locked_pick:
        return locked_pick
    prefix, _, old_id = locked_pick.partition("_")
    new_id = id_map.get(old_id)
    return f"{prefix}_{new_id}" if new_id is not None else locked_pick


def migrate(apply):
    id_map, week, year = build_id_map()
    print(f"Week {week} {year}: {len(id_map)} game ID(s) mapped.")
    for old_id, new_id in id_map.items():
        print(f"  {old_id} -> {new_id}")

    cred_json = os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"]
    db = firestore_client(cred_json)

    docs = list(
        db.collection("picks")
            .where("week", "==", week)
            .where("year", "==", year)
            .stream()
    )
    print(f"Found {len(docs)} picks doc(s) for week {week} {year}.")

    changed_count = 0
    for doc in docs:
        data = doc.to_dict()
        picks = data.get("picks") or {}
        new_picks = rename_picks_keys(picks, id_map)
        if new_picks is None:
            continue

        changed_count += 1
        locked_pick = data.get("lockedPick")
        new_locked_pick = renamed_locked_pick(locked_pick, id_map)

        print(f"Doc {doc.id}:")
        for old_key in picks:
            prefix, _, old_id = old_key.partition("_")
            if old_id in id_map:
                print(f"    {old_key} -> {prefix}_{id_map[old_id]}")
        if new_locked_pick != locked_pick:
            print(f"    lockedPick: {locked_pick} -> {new_locked_pick}")

        if apply:
            update = {"picks": new_picks}
            if new_locked_pick != locked_pick:
                update["lockedPick"] = new_locked_pick
            doc.reference.update(update)

    print(f"{changed_count} doc(s) {'updated' if apply else 'would be updated (dry run)'}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="One-time migration: remap this week's picks doc keys "
                     "from old Odds-API game IDs to new ESPN game IDs."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write to Firestore. Without this flag, only prints the plan.",
    )
    args = parser.parse_args()
    migrate(apply=args.apply)
