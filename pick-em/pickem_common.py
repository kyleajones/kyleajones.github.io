import html
import json
import os

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


def weeks_to_recheck(week):
    """The current week plus the one before it -- catches a Thursday/early
    game that finished before a run, or last week's Monday-nighter right
    after rollover into a new week. Shared by fetch_scores.py and
    update_weekly_picks.py, which both recompute the same two weeks on
    every run for this reason.
    """
    return [week, week - 1] if week > 1 else [week]


def grade_pick(pick_value, pick_type, game_result):
    """Direct port of gradePick() in pick-em/record.js. Keep in sync if
    that logic changes.
    """
    if not game_result:
        return 'PENDING'

    selection, line_str = pick_value.split('|')

    scores = game_result.get('scores', {})
    away_team = game_result.get('away_team')
    home_team = game_result.get('home_team')

    if away_team not in scores or home_team not in scores:
        return 'PENDING'

    away_score = scores[away_team]
    home_score = scores[home_team]

    # A line is either the literal "PK" (pick'em) or a numeric string.
    # Anything else is ungradeable -- notably "N/A", which is what
    # espn_api._format_spread() writes whenever ESPN has published no odds
    # for a game. float("N/A") used to raise ValueError here, which aborted
    # update_leaderboard.py / send_standings_email.py outright, so one
    # player's unpriced pick took down the whole league's standings.
    if line_str == 'PK':
        line = 0.0
    else:
        try:
            line = float(line_str)
        except ValueError:
            return 'PENDING'

    if pick_type == 'Spread':
        # `selection` must name one of the two real teams. Anything else is
        # ungradeable rather than a silent default: without this check an
        # Over/Under value stored under a spread_ key (e.g. "Under|0") fell
        # through to the home-team branch below and got graded as though the
        # total were a spread, which handed out guaranteed wins.
        if selection not in (away_team, home_team):
            return 'PENDING'

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
        # Same reasoning as the Spread branch: a team name stored under an
        # ou_ key is ungradeable, and must be rejected before the push
        # check below, which would otherwise report PUSH for it.
        if selection not in ('Over', 'Under'):
            return 'PENDING'

        total_points = away_score + home_score
        if total_points == line:
            return 'PUSH'
        if selection == 'Over':
            return 'WIN' if total_points > line else 'LOSS'
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
        picks = record.get('picks') or {}

        # A doc with no picks contributes nothing but would still create a
        # 0-point leaderboard row below, since the entry is seeded before
        # the pick loop runs. firestore.rules now rejects empty-picks
        # writes outright, but this also covers any junk doc created
        # before that bound existed (e.g. a fabricated
        # "<uid>_week999_9999"). A player whose picks are all still
        # PENDING is unaffected -- they have picks, so they keep their
        # legitimate 0-point row while the week plays out.
        if not picks:
            continue

        uid = record.get('userId') or record.get('username') or 'Unknown'
        user_name = record.get('username') or 'Anonymous'

        if uid not in user_stats:
            user_stats[uid] = {'name': user_name, 'points': 0, 'w': 0, 'l': 0, 'p': 0}

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


def standings_sort_key(entry):
    """Sort key matching compareStandings() in pick-em/grading.js: points
    desc, then more wins, then fewer losses, then name asc. Keep in sync
    -- record.js and send_standings_email.py render the same ranks, so a
    divergence would have the emailed standings disagree with the web
    leaderboard.
    """
    return (-entry['points'], -entry['w'], entry['l'], entry.get('name') or '')


def rank_standings(sorted_entries):
    """Port of rankStandings() in pick-em/grading.js. Assigns standard
    competition ranking ("1224"): entries tied on points/w/l share a
    rank, and the next distinct entry skips the ranks that tie consumed.
    Expects `sorted_entries` already ordered by standings_sort_key().
    Returns [(rank, entry), ...].

    Name is deliberately not part of the tie test -- it's only a
    display-order tiebreaker, so two players equal on points/w/l are a
    genuine tie and must share a rank.
    """
    ranked = []
    last_rank = 0
    last_key = None
    for index, entry in enumerate(sorted_entries):
        key = (entry['points'], entry['w'], entry['l'])
        if key != last_key:
            last_rank = index + 1
            last_key = key
        ranked.append((last_rank, entry))
    return ranked


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
