import os
import json
import requests
from datetime import datetime, timedelta, timezone

from pickem_common import get_nfl_week, firestore_client

API_KEY = os.environ.get("ODDS_API_KEY")
URL = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/"

def write_current_week():
    """Writes the single canonical NFL week/year -- derived once here
    via get_nfl_week(), the same heuristic used for the Firestore
    matchups mirror below -- to a small static file. auth.js reads this
    instead of maintaining its own JS port of getNFLWeek(), so the
    client and server can never disagree on what week it is.
    """
    now = datetime.now(timezone.utc)
    with open("current_week.json", "w") as f:
        json.dump({"week": get_nfl_week(now), "year": now.year}, f)


def fetch_matchups():
    write_current_week()

    params = {
        "apiKey": API_KEY,
        "regions": "us",
        "markets": "spreads,totals"
    }

    response = requests.get(URL, params=params)
    response.raise_for_status()
    games = response.json()

    matchups = []

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

    if not games:
        # If the API returns absolutely nothing, save an empty list
        with open("matchups.json", "w") as f:
            json.dump([], f)
        return

    # 1. Sort the raw games chronologically FIRST
    games.sort(key=lambda x: x['commence_time'])
    
    # 2. Find the date of the very first game the API returned
    first_game_time = datetime.fromisoformat(games[0]['commence_time'].replace('Z', '+00:00'))
    
    # 3. Create an 7-day window starting from that first game
    end_of_window = first_game_time + timedelta(days=7)
    
    for game in games:
        game_time = datetime.fromisoformat(game['commence_time'].replace('Z', '+00:00'))
        
        # Only include games in that first week's window
        if first_game_time <= game_time <= end_of_window:
            home_team = game['home_team']
            away_team = game['away_team']
            spread_text = "N/A"
            over_under = "N/A"
            
            if game.get('bookmakers'):
                markets = game['bookmakers'][0].get('markets', [])
                
                # Extract spread
                for market in markets:
                    if market['key'] == 'spreads':
                        for outcome in market['outcomes']:
                            if outcome['name'] == away_team:
                                point = outcome.get('point')
                                if point is not None:
                                    spread_text = f"{point:+}" 
                                break
                    
                    # Extract over/under (totals)
                    elif market['key'] == 'totals':
                        for outcome in market['outcomes']:
                            if outcome['name'] == 'Over':
                                point = outcome.get('point')
                                if point is not None:
                                    over_under = f"{point}" 
                                break
                            
            # Lock the spread/total once first published: reuse the existing
            # value for this game if one was already saved, so the line
            # can't shift out from under users who already picked it.
            existing_game = existing_by_id.get(game['id'])
            if existing_game and existing_game.get('spread', 'N/A') != 'N/A':
                spread_text = existing_game['spread']
            if existing_game and existing_game.get('over_under', 'N/A') != 'N/A':
                over_under = existing_game['over_under']

            matchups.append({
                "id": game['id'],
                "away": away_team,
                "home": home_team,
                "spread": spread_text,
                "over_under": over_under,
                "commence_time": game['commence_time']
            })
            
    with open("matchups.json", "w") as f:
        json.dump(matchups, f, indent=4)

    mirror_matchups_to_firestore(matchups)


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


def mirror_matchups_to_firestore(matchups):
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

    now = datetime.now(timezone.utc)
    week_str = f"week{get_nfl_week(now)}"
    year_str = str(now.year)

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
