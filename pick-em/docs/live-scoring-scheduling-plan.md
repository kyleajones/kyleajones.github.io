# Live scoring scheduling reliability — contingency plan

## Status

**Resolved — Option C implemented and confirmed working.** Written
2026-09-30 while monitoring `update-live-scores.yml`'s first live game
windows, after `schedule:` runs showed delays bad enough to undermine the
"live" promise. The Option C CORS blocker was tested and confirmed open
(2026-10-09); `current-week.js` was switched to poll ESPN's scoreboard
endpoint directly, and that held up through a real Thursday night game
(2026-10-08/09).

Follow-up cleanup done once the new path was confirmed: removed
`fetch_live_scores.py`, the `liveScores` Firestore collection/rules, and
the corresponding step from `update-live-scores.yml` (renamed internally
to "Refresh Weekly Picks Board", its only remaining job), since nothing
reads that mirror anymore. The picks-reveal half (`update_weekly_picks.py`)
still runs on that workflow's existing 15-minute `schedule:` cadence, per
the recommendation below — it's less time-critical than scores, so the
same unreliable trigger is an acceptable tradeoff for it.

## Context

`update-live-scores.yml` runs `fetch_live_scores.py` + `update_weekly_picks.py`
every 15 minutes during NFL game windows, via GitHub Actions' `schedule:`
trigger, to keep the Results tab's live scores and pick reveals fresh
without waiting on the once-daily `update-scores.yml` run.

GitHub's own docs state scheduled (`schedule:`) workflow runs are
best-effort with no SLA, and can be delayed during periods of high load —
and we've already observed our existing daily scheduled jobs run hours
late at times. The live-scoring cadence assumes ~15-minute freshness
during a ~3-hour game window; if actual runs are delayed by an hour or
more, most of a game could pass with no live update at all, which defeats
the point of building this. We shifted the cron off `:00/:15/:30/:45` (the
most oversubscribed minutes globally) as a first, low-cost mitigation, but
that doesn't fix a systemic account/repo-level delay if that's what's
actually happening.

This doc lays out the alternatives if the `schedule:` trigger turns out to
be fundamentally unworkable for this use case.

## Options considered

### Option A — Trigger via `workflow_dispatch` from an external cron pinger

Keep the workflow and all of its Python/Firestore logic exactly as-is;
change only *how* it's triggered. An external, free scheduling service
(e.g. cron-job.org) sends an authenticated HTTPS request every 15 minutes
during game windows to GitHub's REST API:

```
POST /repos/{owner}/{repo}/actions/workflows/update-live-scores.yml/dispatches
Authorization: Bearer <fine-grained PAT with Actions: read/write>
Content-Type: application/json

{ "ref": "main" }
```

GitHub's `schedule:` event is documented and widely reported to be treated
as lower priority than API-triggered (`workflow_dispatch`/
`repository_dispatch`) runs — this targets that specific mechanism
directly.

- **Pros**: zero changes to the actual fetch/write logic; stays entirely
  on free tiers (GitHub Actions + a free external cron service); smallest
  possible change once the delay is confirmed to be the `schedule:` event
  itself.
- **Cons**: introduces a new external dependency (the cron service) and a
  GitHub PAT that has to live outside GitHub, in that third-party service
  — a real secret-handling tradeoff. The external service's own uptime/free-tier
  limits become the new single point of failure. Not a guaranteed fix —
  no official SLA on either side, needs to be validated empirically same
  as everything else.

### Option B — Google Cloud Scheduler + Cloud Functions (2nd gen)

Move the live-scoring job off GitHub Actions entirely. Cloud Scheduler
(a dedicated, SLA-backed scheduling product) fires an HTTPS Cloud
Function on a precise cadence; the function runs the equivalent of
`fetch_live_scores.py` + `update_weekly_picks.py` directly against
Firestore, in the same GCP project as this Firebase project already
lives in.

- **Pros**: the most reliable/precise timing option by a wide margin —
  Cloud Scheduler has an actual uptime SLA, unlike GitHub's best-effort
  `schedule:` queue. Stays entirely within the Firebase/GCP ecosystem.
  Cloud Functions can use the Admin SDK via their own runtime identity,
  so `FIREBASE_SERVICE_ACCOUNT_JSON` wouldn't need to exist as a secret
  for this path at all.
- **Cons**: **requires upgrading from the Spark (free) plan to Blaze
  (pay-as-you-go)** — Spark's Cloud Functions can't make outbound calls to
  non-Google APIs, and ESPN's scoreboard endpoint is exactly that. Blaze
  needs a linked billing account/card. Given how small and infrequent this
  workload is, real dollar cost should land at ~$0/month (well inside
  Blaze's free monthly invocation/scheduler allotments) — but it's a
  bigger administrative step (billing account, watching for runaway
  costs) than the rest of this project has needed so far. Also requires
  porting `fetch_live_scores.py`'s logic into a Cloud Function (Python
  2nd-gen functions support this fairly directly, but it's still
  real rework, not a pure config change).

### Option C — Client-side direct polling of ESPN's scoreboard endpoint

Skip the server-side cron for the *score* half entirely. `current-week.js`
already polls every 60 seconds via `liveTick()` — point that poll directly
at ESPN's scoreboard endpoint (the same one `espn_api.py` already calls)
instead of at the Firestore `liveScores` mirror a cron job would have to
keep populating. Scores become genuinely real-time, synced to whenever a
visitor's browser is open and polling — there's no schedule to be delayed,
because there's no schedule.

- **Pros**: completely sidesteps the GitHub Actions delay question for
  scores specifically. No new infrastructure, no billing risk, no new
  secrets. Conceptually simpler than either A or B.
- **Cons**:
  - **Unverified whether ESPN's endpoint allows cross-origin browser
    requests (CORS)** — this needs a real from-a-browser test before
    committing to the approach. If CORS is blocked, this option is dead
    on arrival without adding a proxy (which would reintroduce a
    server-side piece anyway).
  - Doesn't cover the *picks-reveal* half of the original ask
    (`weeklyPicks`) — a client can't be trusted to decide which of its
    rivals' picks are safe to reveal, so `update_weekly_picks.py` would
    still need some schedule. That piece is less time-critical than
    scores though (a day-old picks reveal is much less painful than a
    day-old score), so it could plausibly just stay on GitHub's current
    best-effort `schedule:`, or move to Option A on its own, smaller
    scope.
  - Departs from the "server is the single source of truth, client just
    displays" pattern the rest of the app follows. Also shifts from one
    request per 15-minute job to one request per open browser tab per
    minute — trivial at this app's (friend-league) scale, but worth
    naming.

## Recommendation

1. **Test Option C's CORS feasibility first** — it's a 10-minute
   experiment (a `fetch()` against the scoreboard endpoint from browser
   devtools on a page not served from ESPN's own origin) and, if it
   works, is the cleanest fix available: free, no new infra, no new
   secrets, and it permanently removes the reliability question for
   scores.
2. **If CORS blocks it, fall back to Option A** (external dispatch
   trigger) — it's the next-cheapest fix, requires no new billing, and
   reuses all of the existing Python/Firestore code unchanged.
3. **Treat Option B as the "do it properly" fallback**, only worth the
   Blaze-plan administrative overhead if both A and C are proven
   insufficient by real data — not a first move.

## How to decide

1. Watch `update-live-scores.yml`'s run history across the next 2-3 live
   game windows; compare each run's scheduled vs. actual start time.
2. If the delay is consistently large enough to matter (rule of thumb:
   >20-30 minutes, since that starts eating meaningfully into a ~3-hour
   game window) — proceed with the recommendation above, starting with
   the Option C CORS test.
3. If delays are occasional/minor, the current design plus the `:02/:17/
   :32/:47` offset is probably good enough — no need to act on this doc.

## Reference: relevant files

- `current-week.js`'s `fetchEspnLiveScores()` / `liveTick()` /
  `renderWeek()` — the implemented Option C: direct client-side poll of
  ESPN's scoreboard endpoint, parsed the same way `espn_api.py`'s
  `completed_scores()` is, plus the in-progress (`status.type.state ==
  "in"`) case that function doesn't need.
- `.github/workflows/update-live-scores.yml` — still runs
  `update_weekly_picks.py` on the existing `schedule:`-based 15-minute
  cadence for the picks-reveal half; no longer runs any score-fetching
  step (`fetch_live_scores.py` was removed, along with the `liveScores`
  Firestore collection/rules it wrote to).
- `espn_api.py` — still the shared ESPN-parsing module for everything
  server-side (`week_games()`, `completed_scores()`, etc.); no longer has
  a `live_scores()`/`_scored_games()` pair, now that nothing calls them.
- Firebase plan: currently Spark (free) — confirmed sufficient for the
  current Firestore-mirror design; Option B is the only one of these
  three that requires moving off it.
