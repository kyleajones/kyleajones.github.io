import os
import json
import requests
from datetime import datetime, timedelta, timezone

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
    
    # Create a time window for the "current week" (next 8 days)
    now = datetime.now(timezone.utc)
    end_of_week = now + timedelta(days=8)
    
    for game in games:
        # Parse the start time (e.g., '2024-09-05T00:20:00Z')
        game_time = datetime.fromisoformat(game['commence_time'].replace('Z', '+00:00'))
        
        # Only include games happening in our 8-day window
        if now <= game_time <= end_of_week:
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
                "commence_time": game['commence_time'] # Send raw time to frontend
            })
            
    # Sort matchups chronologically so Thursday games appear first
    matchups.sort(key=lambda x: x['commence_time'])
    
    with open("matchups.json", "w") as f:
        json.dump(matchups, f, indent=4)
        
if __name__ == "__main__":
    fetch_matchups()
