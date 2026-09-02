import html
import json
import os
from datetime import datetime

import requests
import firebase_admin
from firebase_admin import auth as firebase_auth, credentials, firestore

RESEND_URL = "https://api.resend.com/emails"
# Combined to+cc+bcc recipients per Resend API call. Confirm this against
# Resend's current docs if the league roster ever grows near it.
RESEND_RECIPIENT_LIMIT = 50


def escape_html(value):
    """Escape user-controlled strings (display names) before interpolating
    them into an HTML email body. Same intent as escapeHtml() in
    pick-em/record.js, applied here since display names are just as
    user-controlled in this context.
    """
    return html.escape(str(value), quote=True)


def get_nfl_week(date):
    """The sole implementation of the Labor Day + N weeks calendar
    heuristic used to determine the current NFL week. update_picks.py
    calls this once daily and writes the result to
    pick-em/current_week.json, which the client (auth.js) fetches
    instead of computing the week itself -- there is no JS port of this
    logic to keep in sync anymore. Comments below reference JS Date
    semantics only because this was originally ported from one; JS Date
    months are 0-indexed, Python's are 1-indexed, so the month
    comparisons below are shifted by one accordingly.
    """
    date = date.replace(tzinfo=None)
    current_year = date.year

    def get_labor_day(yr):
        sept1 = datetime(yr, 9, 1)
        day_of_week = (sept1.weekday() + 1) % 7  # JS getDay(): Sun=0..Sat=6
        days_to_first_monday = (1 - day_of_week + 7) % 7
        return datetime(yr, 9, 1 + days_to_first_monday)

    season_year = current_year
    if date.month < 8:  # JS: date.getMonth() < 7 means Jan(0)-Jul(6)
        season_year = current_year - 1

    labor_day = get_labor_day(season_year)
    week2_start = datetime(season_year, 9, labor_day.day + 8)

    if date < week2_start:
        return 1

    diff_days = (date - week2_start).days
    weeks_since_week2 = diff_days // 7

    week_num = 2 + weeks_since_week2
    return min(week_num, 18)


def grade_pick(pick_value, pick_type, game_result):
    """Direct port of gradePick() in pick-em/record.js. Keep in sync if
    that logic changes.
    """
    if not game_result:
        return 'PENDING'

    selection, line_str = pick_value.split('|')
    line = 0.0 if line_str == 'PK' else float(line_str)

    scores = game_result.get('scores', {})
    away_team = game_result.get('away_team')
    home_team = game_result.get('home_team')

    if away_team not in scores or home_team not in scores:
        return 'PENDING'

    away_score = scores[away_team]
    home_score = scores[home_team]

    if pick_type == 'Spread':
        is_away = selection == away_team
        picked_score = away_score if is_away else home_score
        opponent_score = home_score if is_away else away_score
        adjusted_score = picked_score + line

        if adjusted_score > opponent_score:
            return 'WIN'
        if adjusted_score < opponent_score:
            return 'LOSS'
        return 'PUSH'
    elif pick_type == 'Over/Under':
        total_points = away_score + home_score
        if total_points == line:
            return 'PUSH'
        if selection == 'Over':
            return 'WIN' if total_points > line else 'LOSS'
        if selection == 'Under':
            return 'WIN' if total_points < line else 'LOSS'

    return 'PENDING'


def compute_points(docs, results_data):
    """Direct port of the scoring loop in pick-em/record.js (gradePick +
    point tally: WIN=3, or 5 if locked; PUSH=1; LOSS=0). Keep in sync if
    that logic changes.

    `docs` is an iterable of Firestore `picks` doc dicts. Returns
    {uid: {"name": str, "points": int, "w": int, "l": int, "p": int}}.
    """
    user_stats = {}

    for record in docs:
        uid = record.get('userId') or record.get('username') or 'Unknown'
        user_name = record.get('username') or 'Anonymous'

        if uid not in user_stats:
            user_stats[uid] = {'name': user_name, 'points': 0, 'w': 0, 'l': 0, 'p': 0}

        picks = record.get('picks') or {}
        for pick_key, pick_value in picks.items():
            game_id = pick_key.split('_')[1]
            pick_type = 'Spread' if pick_key.startswith('spread') else 'Over/Under'
            status = grade_pick(pick_value, pick_type, results_data.get(game_id))
            is_locked = pick_key == record.get('lockedPick')

            if status == 'WIN':
                user_stats[uid]['w'] += 1
                user_stats[uid]['points'] += 5 if is_locked else 3
            elif status == 'PUSH':
                user_stats[uid]['p'] += 1
                user_stats[uid]['points'] += 1
            elif status == 'LOSS':
                user_stats[uid]['l'] += 1

    return user_stats


def _firebase_app(cred_json):
    try:
        return firebase_admin.get_app()
    except ValueError:
        cred = credentials.Certificate(json.loads(cred_json))
        return firebase_admin.initialize_app(cred)


def firestore_client(cred_json):
    """Returns a firebase_admin.firestore client for reading the `picks`
    collection. The Admin SDK bypasses firestore.rules, so this works
    read-only regardless of the public read rule.
    """
    _firebase_app(cred_json)
    return firestore.client()


def list_player_emails(cred_json):
    """Lists every signed-up account's email directly from Firebase Auth.
    Skips accounts with no email on file.
    """
    _firebase_app(cred_json)
    emails = []
    for user in firebase_auth.list_users().iterate_all():
        if user.email:
            emails.append(user.email)
    return emails


def resolve_recipients(cred_json):
    """Returns the BCC recipient list for outgoing emails. If
    TEST_RECIPIENT_EMAIL is set, sends only to that address instead of the
    full player list — used for one-off test sends before relying on the
    real schedule.
    """
    test_recipient = os.environ.get('TEST_RECIPIENT_EMAIL')
    if test_recipient:
        return [test_recipient]
    return list_player_emails(cred_json)


def send_resend_email(subject, html_body, bcc_list):
    """POSTs to Resend's API. `to` is set to the sending address itself
    (a required, non-empty field) — the real audience is entirely in
    `bcc`, so no player ever sees another player's email address. Splits
    bcc_list into chunks of RESEND_RECIPIENT_LIMIT to stay under the API's
    per-call recipient cap.
    """
    if not bcc_list:
        print("No recipients to send to; skipping.")
        return

    api_key = os.environ['RESEND_API_KEY']
    headers = {'Authorization': f'Bearer {api_key}'}

    for i in range(0, len(bcc_list), RESEND_RECIPIENT_LIMIT):
        chunk = bcc_list[i:i + RESEND_RECIPIENT_LIMIT]
        response = requests.post(
            RESEND_URL,
            headers=headers,
            json={
                'from': "3woks Pick 'Em <picks@pickem.3woks.com>",
                'to': ['picks@pickem.3woks.com'],
                'bcc': chunk,
                'subject': subject,
                'html': html_body,
            },
        )
        response.raise_for_status()
