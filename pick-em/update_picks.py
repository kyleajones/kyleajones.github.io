import os
import json
from datetime import datetime

from espn_api import current_week_and_year, week_games
from pickem_common import firestore_client


def write_current_week(week, season_type, year):
    """Writes the single canonical NFL week/year -- from ESPN's own
    scoreboard endpoint -- to a small static file. auth.js reads this
    instead of maintaining its own JS port of a week-calculation
    heuristic, so the client and server can never disagree on what
    week it is. `season_type` is included so send_standings_email.py can
    query ESPN for a specific past week without needing its own extra
    call to current_week_and_year() just to learn it.
    """
    with open("current_week.json", "w") as f:
        json.dump({"week": week, "season_type": season_type, "year": year}, f)


def fetch_matchups():
    week, season_type, year = current_week_and_year()
    write_current_week(week, season_type, year)

    games = week_games(week, season_type, year)

    if not games:
        # If ESPN returns absolutely nothing for this week, save an empty list
        with open("matchups.json", "w") as f:
            json.dump([], f)
        return

    # Load any existing matchups so already-published lines can be locked in
    # for the rest of the week, regardless of how the market line moves.
    existing_by_id = {}
    if os.path.exists("matchups.json"):
        try:
            with open("matchups.json", "r") as f:
                for existing_game in json.load(f):
                    existing_by_id[existing_game["id"]] = existing_game
        except (json.JSONDecodeError, KeyError):
            existing_by_id = {}

    matchups = []
    for game in games:
        spread_text = game["spread"]
        over_under = game["over_under"]

        # Lock the spread/total once first published: reuse the existing
        # value for this game if one was already saved, so the line
        # can't shift out from under users who already picked it.
        existing_game = existing_by_id.get(game["id"])
        if existing_game and existing_game.get("spread", "N/A") != "N/A":
            spread_text = existing_game["spread"]
        if existing_game and existing_game.get("over_under", "N/A") != "N/A":
            over_under = existing_game["over_under"]

        matchups.append({
            "id": game["id"],
            "away": game["away"],
            "home": game["home"],
            "spread": spread_text,
            "over_under": over_under,
            "commence_time": game["commence_time"],
        })

    with open("matchups.json", "w") as f:
        json.dump(matchups, f, indent=4)

    mirror_matchups_to_firestore(matchups, week, year)


def js_number_to_string(n):
    """Mimics JavaScript's default Number-to-string conversion for the
    range of values a spread can take (integers and half-points), where
    Python's str()/f-string formatting of a float keeps a trailing .0
    that JS's Number-to-string conversion does not produce (e.g. Python
    `f"{-7.0}"` -> "-7.0", JS `` `${-7.0}` `` -> "-7").
    """
    if n == int(n):
        return str(int(n))
    return str(n)


def compute_lines(away_spread_raw):
    """Port of the away/home spread computation in pick-em/matchups.js.
    `away_spread_raw` is the raw stored spread string from matchups.json
    (e.g. "+7", "-3.5", "N/A"). Returns (away_line, home_line) exactly as
    they'd appear in a pick's stored "<Team>|<Line>" value, matching what
    a legitimate client-side selection would produce. The away side is
    never reformatted by the client, so away_line is just away_spread_raw
    verbatim (except the "PK" case, where the client overwrites it). Keep
    in sync if matchups.js's logic changes.
    """
    if away_spread_raw == "N/A":
        return "N/A", "N/A"

    spread_val = float(away_spread_raw)
    if spread_val == 0:
        return "PK", "PK"

    inverted = -spread_val
    home_line = f"+{js_number_to_string(inverted)}" if inverted > 0 else js_number_to_string(inverted)
    return away_spread_raw, home_line


def mirror_matchups_to_firestore(matchups, week, year):
    """Writes a read-only mirror of each currently-published game to
    Firestore's `matchups` collection via the Admin SDK (bypasses
    firestore.rules), so firestore.rules can validate incoming picks
    against real game data it otherwise has no way to see -- rules can't
    read matchups.json, a static file served over HTTP, only other
    Firestore documents.
    """
    cred_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not cred_json:
        print("FIREBASE_SERVICE_ACCOUNT_JSON not set; skipping Firestore matchups mirror.")
        return

    db = firestore_client(cred_json)

    week_str = f"week{week}"
    year_str = str(year)

    for game in matchups:
        away_line, home_line = compute_lines(game["spread"])
        commence_time = datetime.fromisoformat(game["commence_time"].replace("Z", "+00:00"))

        db.collection("matchups").document(game["id"]).set({
            "away": game["away"],
            "home": game["home"],
            "awayLine": away_line,
            "homeLine": home_line,
            "overUnder": game["over_under"],
            "commenceTime": commence_time,
            "weekStr": week_str,
            "yearStr": year_str,
        })


if __name__ == "__main__":
    fetch_matchups()
