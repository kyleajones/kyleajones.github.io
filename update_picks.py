import os
import json
import requests

API_KEY = os.environ.get("ODDS_API_KEY")
URL = f"https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey={API_KEY}®ions=us&markets=spreads"

def fetch_matchups():
    response = requests.get(URL)
    response.raise_for_status()
    games = response.json()
    
    matchups = []
    for game in games:
        home_team = game['home_team']
        away_team = game['away_team']
        spread_text = "N/A"
        
        # Grab the first available bookmaker's spread for the away team
        if game.get('bookmakers'):
            markets = game['bookmakers'][0].get('markets', [])
            if markets and markets[0]['key'] == 'spreads':
                for outcome in markets[0]['outcomes']:
                    if outcome['name'] == away_team:
                        point = outcome.get('point')
                        if point is not None:
                            # Format with a plus sign for positive spreads
                            spread_text = f"{point:+}" 
                        break
                        
        matchups.append({
            "id": game['id'],
            "away": away_team,
            "home": home_team,
            "spread": spread_text
        })
        
    with open("matchups.json", "w") as f:
        json.dump(matchups, f, indent=4)
        
if __name__ == "__main__":
    fetch_matchups()
  
