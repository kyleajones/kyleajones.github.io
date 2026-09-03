import requests

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def _scoreboard(week=None, season_type=None, year=None):
    """Hits ESPN's undocumented (no API key) scoreboard endpoint. With no
    args, ESPN returns its own notion of the current week. Passing all
    three args returns the full game list for that specific week,
    past or present.
    """
    params = {}
    if week is not None:
        params["week"] = week
        params["seasontype"] = season_type
        params["dates"] = year
    response = requests.get(BASE, params=params)
    response.raise_for_status()
    return response.json()


def current_week_and_year():
    """No params -> ESPN's own notion of the current week. Returns
    (week, season_type, year).
    """
    data = _scoreboard()
    return data["week"]["number"], data["season"]["type"], data["season"]["year"]


def _competitor(competitors, home_away):
    return next(c for c in competitors if c["homeAway"] == home_away)


def _format_spread(line):
    """Converts ESPN's pointSpread `.close.line` string (e.g. "+3.5",
    "-7", "0") into matchups.json's existing convention: "PK" for a
    pick'em line, "N/A" if no odds are available, otherwise the line
    as ESPN reports it.
    """
    if line is None:
        return "N/A"
    if float(line) == 0:
        return "PK"
    return line


def _format_over_under(value):
    if value is None:
        return "N/A"
    return str(value)


def week_games(week, season_type, year):
    """Full game list for a specific week, in matchups.json's existing
    shape: [{id, away, home, spread, over_under, commence_time}, ...].
    spread is the AWAY side's line as a string (e.g. "+3.5", "PK",
    "N/A") -- same convention update_picks.py already produces today,
    read directly from ESPN's odds[0].pointSpread.away.close.line
    instead of computed.
    """
    data = _scoreboard(week=week, season_type=season_type, year=year)
    games = []

    for event in data.get("events", []):
        competition = event["competitions"][0]
        competitors = competition["competitors"]
        away = _competitor(competitors, "away")
        home = _competitor(competitors, "home")

        odds = competition.get("odds") or []
        point_spread = odds[0].get("pointSpread") if odds else None
        over_under = odds[0].get("overUnder") if odds else None
        away_line = point_spread["away"]["close"]["line"] if point_spread else None

        games.append({
            "id": event["id"],
            "away": away["team"]["displayName"],
            "home": home["team"]["displayName"],
            "spread": _format_spread(away_line),
            "over_under": _format_over_under(over_under),
            "commence_time": event["date"],
        })

    return games


def week_is_complete(week, season_type, year):
    """True if every game on this week's schedule has finished
    (status.type.completed). A week with no games at all (bye week,
    off-season) returns False -- there's nothing to report on, so
    callers should treat that the same as "not done".
    """
    data = _scoreboard(week=week, season_type=season_type, year=year)
    events = data.get("events", [])
    if not events:
        return False
    return all(e["competitions"][0]["status"]["type"]["completed"] for e in events)


def completed_scores(week, season_type, year):
    """Games with status.type.completed == true for a specific week, in
    results.json's existing shape:
    {event_id: {away_team, home_team, scores: {team_name: score}}}.
    """
    data = _scoreboard(week=week, season_type=season_type, year=year)
    results = {}

    for event in data.get("events", []):
        competition = event["competitions"][0]
        if not competition["status"]["type"]["completed"]:
            continue

        competitors = competition["competitors"]
        away = _competitor(competitors, "away")
        home = _competitor(competitors, "home")

        if away.get("score") is None or home.get("score") is None:
            continue

        away_team = away["team"]["displayName"]
        home_team = home["team"]["displayName"]

        results[event["id"]] = {
            "away_team": away_team,
            "home_team": home_team,
            "scores": {
                away_team: int(away["score"]),
                home_team: int(home["score"]),
            },
        }

    return results
