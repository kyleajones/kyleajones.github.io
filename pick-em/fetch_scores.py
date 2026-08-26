import os
import json
import requests

# Use the exact same environment variable name as your update_picks script
API_KEY = os.environ.get('ODDS_API_KEY')
SPORT = 'americanfootball_nfl'
DAYS_FROM = 3  # The Odds API allows looking back 1 to 3 days for recent scores

def fetch_scores():
    print("Fetching recent NFL scores...")
    url = f"https://api.the-odds-api.com/v4/sports/{SPORT}/scores/?apiKey={API_KEY}&daysFrom={DAYS_FROM}"
    
    response = requests.get(url)
    if response.status_code != 200:
        print(f"Error fetching scores: {response.text}")
        return

    data = response.json()
    
    # 1. Load existing results so we don't wipe out past weeks or Thursday games
    completed_games = {}
    if os.path.exists('results.json'):
        try:
            with open('results.json', 'r') as f:
                completed_games = json.load(f)
        except json.JSONDecodeError:
            completed_games = {}

    # 2. Merge newly completed games
    for game in data:
        if game.get('completed') and game.get('scores'):
            scores_list = game['scores']
            team_scores = {
                team['name']: int(team['score']) 
                for team in scores_list if team.get('score') is not None
            }
            if len(team_scores) == 2:
                completed_games[game['id']] = {
                    "away_team": game['away_team'],
                    "home_team": game['home_team'],
                    "scores": team_scores
                }

    # 3. Save merged results back to disk
    with open('results.json', 'w') as f:
        json.dump(completed_games, f, indent=4)
        
    print(f"Successfully updated results.json. Total stored games: {len(completed_games)}")

if __name__ == "__main__":
    fetch_scores()
