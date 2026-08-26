import os
import json
import requests
from datetime import datetime, timedelta

API_KEY = os.environ.get("ODDS_API_KEY")
URL = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/"

def fetch_matchups():
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
        
if __name__ == "__main__":
    fetch_matchups()
