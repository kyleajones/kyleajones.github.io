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
        "markets": "spreads"
    }
    
    response = requests.get(URL, params=params)
    response.raise_for_status()
    games = response.json()
    
    matchups = []
    
    if not games:
        # If the API returns absolutely nothing, save an empty list
        with open("matchups.json", "w") as f:
            json.dump([], f)
        return

    # 1. Sort the raw games chronologically FIRST
    games.sort(key=lambda x: x['commence_time'])
    
    # 2. Find the date of the very first game the API returned
    first_game_time = datetime.fromisoformat(games[0]['commence_time'].replace('Z', '+00:00'))
    
    # 3. Create an 8-day window starting from that first game
    end_of_window = first_game_time + timedelta(days=8)
    
    for game in games:
        game_time = datetime.fromisoformat(game['commence_time'].replace('Z', '+00:00'))
        
        # Only include games in that first week's window
        if first_game_time <= game_time <= end_of_window:
            home_team = game['home_team']
            away_team = game['away_team']
            spread_text = "N/A"
            
            if game.get('bookmakers'):
                markets = game['bookmakers'][0].get('markets', [])
                if markets and markets[0]['key'] == 'spreads':
                    for outcome in markets[0]['outcomes']:
                        if outcome['name'] == away_team:
                            point = outcome.get('point')
                            if point is not None:
                                spread_text = f"{point:+}" 
                            break
                            
            matchups.append({
                "id": game['id'],
                "away": away_team,
                "home": home_team,
                "spread": spread_text,
                "commence_time": game['commence_time'] 
            })
            
    with open("matchups.json", "w") as f:
        json.dump(matchups, f, indent=4)
        
if __name__ == "__main__":
    fetch_matchups()
    
