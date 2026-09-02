import json
import os

from espn_api import completed_scores, current_week_and_year


def fetch_scores():
    print("Fetching recent NFL scores...")

    week, season_type, year = current_week_and_year()

    # Check the current week and the one before it -- catches a
    # Thursday/early game that finished before this runs, or last week's
    # Monday-nighter right after rollover into a new week.
    weeks_to_check = [week]
    if week > 1:
        weeks_to_check.append(week - 1)

    # Load existing results so we don't wipe out past weeks or Thursday games
    completed_games = {}
    if os.path.exists('results.json'):
        try:
            with open('results.json', 'r') as f:
                completed_games = json.load(f)
        except json.JSONDecodeError:
            completed_games = {}

    # Merge newly completed games
    for w in weeks_to_check:
        completed_games.update(completed_scores(w, season_type, year))

    # Save merged results back to disk
    with open('results.json', 'w') as f:
        json.dump(completed_games, f, indent=4)

    print(f"Successfully updated results.json. Total stored games: {len(completed_games)}")


if __name__ == "__main__":
    fetch_scores()
