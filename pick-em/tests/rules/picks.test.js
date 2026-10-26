const { before, after, afterEach, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, deleteDoc } = require("firebase/firestore");

let testEnv;

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-pickem",
    firestore: {
      rules: fs.readFileSync(
        path.join(__dirname, "..", "..", "firestore.rules"),
        "utf8"
      ),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// Seeds the matchups/{gameId} mirror docs the same way update_picks.py's
// Admin SDK actually writes them in production -- tests should seed data
// the same way prod writes it, not rely on the rules under test to also
// seed themselves.
async function seedMatchups() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "matchups/future-game"), {
      away: "Team A",
      home: "Team B",
      awayLine: "+3",
      homeLine: "-3",
      overUnder: "44.5",
      commenceTime: FUTURE,
      weekStr: "week1",
      yearStr: "2026",
    });
    await setDoc(doc(db, "matchups/started-game"), {
      away: "Team C",
      home: "Team D",
      awayLine: "-7",
      homeLine: "+7",
      overUnder: "50.5",
      commenceTime: PAST,
      weekStr: "week1",
      yearStr: "2026",
    });
    await setDoc(doc(db, "matchups/wrong-week-game"), {
      away: "Team E",
      home: "Team F",
      awayLine: "+2.5",
      homeLine: "-2.5",
      overUnder: "41.5",
      commenceTime: FUTURE,
      weekStr: "week2",
      yearStr: "2026",
    });
    // A game ESPN has published no odds for yet -- update_picks.py mirrors
    // "N/A" through verbatim from espn_api._format_spread().
    await setDoc(doc(db, "matchups/unpriced-game"), {
      away: "Team G",
      home: "Team H",
      awayLine: "N/A",
      homeLine: "N/A",
      overUnder: "N/A",
      commenceTime: FUTURE,
      weekStr: "week1",
      yearStr: "2026",
    });
  });
}

async function seedPickDoc(pickId, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "picks", pickId), data);
  });
}

function aliceDb() {
  return testEnv.authenticatedContext("alice").firestore();
}

function bobDb() {
  return testEnv.authenticatedContext("bob").firestore();
}

function unauthedDb() {
  return testEnv.unauthenticatedContext().firestore();
}

// ---- Read ----

test("owner can read their own /picks/{pickId}", async () => {
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: {},
  });
  await assertSucceeds(getDoc(doc(aliceDb(), "picks/alice_week1_2026")));
});

test("a different authenticated user cannot read someone else's picks", async () => {
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: {},
  });
  await assertFails(getDoc(doc(bobDb(), "picks/alice_week1_2026")));
});

test("unauthenticated users cannot read /picks/{pickId} at all", async () => {
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: {},
  });
  await assertFails(getDoc(doc(unauthedDb(), "picks/alice_week1_2026")));
});

test("reading a nonexistent doc succeeds for any authenticated uid (resource == null guard)", async () => {
  await assertSucceeds(getDoc(doc(aliceDb(), "picks/alice_week99_2026")));
});

// ---- Create ----

// Both of these use an otherwise-VALID pick so that the mismatch named
// in the test is the only reason the write fails. With `picks: {}` they
// would also trip the size() >= 1 bound below, and so would still pass
// even if the pickId/userId check they exist to cover were removed.
test("create rejects a pickId not matching the caller's own uid_weekN_year", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/bob_week1_2026"), {
      userId: "alice",
      picks: { "spread_future-game": "Team A|+3" },
    })
  );
});

test("create rejects a userId field mismatched from request.auth.uid", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "bob",
      picks: { "spread_future-game": "Team A|+3" },
    })
  );
});

// An empty picks map passes allPicksOk() vacuously -- there are no keys
// to find a mirrored game for -- so size() >= 1 is the only thing that
// stops a junk doc at a fabricated week/year from being created and then
// rendered as a 0-point leaderboard row.
//
// The read/delete tests seed their docs via withSecurityRulesDisabled(),
// which bypasses these rules entirely, so their `picks: {}` fixtures are
// unaffected by this bound.
test("create rejects an empty picks map", async () => {
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: {},
    })
  );
});

test("create rejects an empty picks map at a fabricated week/year", async () => {
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week999_9999"), {
      userId: "alice",
      picks: {},
    })
  );
});

test("update cannot empty out an existing picks map", async () => {
  await seedMatchups();
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: { "spread_future-game": "Team A|+3" },
  });
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: {},
    })
  );
});

test("create rejects more than 7 picks", async () => {
  const picks = {};
  for (let i = 0; i < 8; i++) {
    picks[`spread_game${i}`] = "Nonsense|999";
  }
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks,
    })
  );
});

test("create accepts the away-line and Over derived pick strings", async () => {
  await seedMatchups();
  await assertSucceeds(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: {
        "spread_future-game": "Team A|+3",
        "ou_future-game": "Over|44.5",
      },
    })
  );
});

test("create accepts the home-line and Under derived pick strings", async () => {
  await seedMatchups();
  await assertSucceeds(
    setDoc(doc(bobDb(), "picks/bob_week1_2026"), {
      userId: "bob",
      picks: {
        "spread_future-game": "Team B|-3",
        "ou_future-game": "Under|44.5",
      },
    })
  );
});

test("create rejects a garbage pick value", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_future-game": "Nonsense|999" },
    })
  );
});

test("create rejects a pick referencing the right game but wrong doc week/year", async () => {
  await seedMatchups();
  // wrong-week-game's mirror doc says weekStr "week2", but this pick
  // doc's own id says "week1" -- must not match.
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_wrong-week-game": "Team E|+2.5" },
    })
  );
});

test("create rejects a pick referencing a matchup whose commenceTime is already in the past", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_started-game": "Team C|-7" },
    })
  );
});

// ---- Document access budget ----

// Seeds 4 future games, enough to build a full 7-pick slate from their
// spread + over/under sides.
async function seedSevenPickSlate() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (let i = 1; i <= 4; i++) {
      await setDoc(doc(db, `matchups/budget-game${i}`), {
        away: `Away ${i}`,
        home: `Home ${i}`,
        awayLine: "+3",
        homeLine: "-3",
        overUnder: "44.5",
        commenceTime: FUTURE,
        weekStr: "week1",
        yearStr: "2026",
      });
    }
  });
}

// 7 picks across 4 games: one side of each spread, plus 3 over/unders.
function sevenFreshPicks() {
  return {
    "spread_budget-game1": "Away 1|+3",
    "spread_budget-game2": "Home 2|-3",
    "spread_budget-game3": "Away 3|+3",
    "spread_budget-game4": "Home 4|-3",
    "ou_budget-game1": "Over|44.5",
    "ou_budget-game2": "Under|44.5",
    "ou_budget-game3": "Over|44.5",
  };
}

// Regression test for the document-access budget documented on
// allPicksOk(). Firestore permits only 10 get()/exists() calls per
// single-document rules evaluation. pickIsValid() used to spend 2 per
// pick (exists() then get() on the same path), so a full 7-pick slate
// needed ~14-16 and was rejected with permission-denied -- a legitimate
// save failing for a reason indistinguishable from a real rule
// violation. Every other test in this file uses only 1-2 picks, so none
// of them exercise the limit.
test("create accepts a full slate of 7 fresh picks (access budget)", async () => {
  await seedSevenPickSlate();
  await assertSucceeds(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: sevenFreshPicks(),
    })
  );
});

test("create accepts 7 fresh picks plus a lockedPick (access budget)", async () => {
  await seedSevenPickSlate();
  await assertSucceeds(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: sevenFreshPicks(),
      lockedPick: "spread_budget-game1",
    })
  );
});

// The worst case for the budget: 7 fresh picks revalidated on an UPDATE
// that also has a stored lockedPick, so lockIsFrozen() spends its own
// get() on top of the 7. None of the 7 can use pickUnchanged(), since
// every value differs from what's stored.
test("update accepts 7 changed picks with an existing unfrozen lock (access budget)", async () => {
  await seedSevenPickSlate();
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: { "spread_budget-game1": "Home 1|-3" },
    lockedPick: "spread_budget-game1",
  });
  await assertSucceeds(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: sevenFreshPicks(),
      lockedPick: "ou_budget-game1",
    })
  );
});

// ---- Pick type must match the key prefix ----

// These four previously passed validation: pickIsValid() accepted any of
// the four legitimate values regardless of the key's spread_/ou_ prefix.
// A player could store "spread_<id>": "Under|0", which the graders then
// read as a team name, grading the home side with the total as a spread --
// a forged guaranteed win worth 5 points when locked.

test("create rejects an Over value stored under a spread_ key", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_future-game": "Over|44.5" },
    })
  );
});

test("create rejects an Under value stored under a spread_ key", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_future-game": "Under|44.5" },
    })
  );
});

test("create rejects an away-team value stored under an ou_ key", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "ou_future-game": "Team A|+3" },
    })
  );
});

test("create rejects a home-team value stored under an ou_ key", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "ou_future-game": "Team B|-3" },
    })
  );
});

test("create rejects a pick key with neither a spread_ nor ou_ prefix", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "bogus_future-game": "Team A|+3" },
    })
  );
});

// ---- Unpriced ("N/A") lines are not pickable ----

test("create rejects a spread pick on a game with no published line", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_unpriced-game": "Team G|N/A" },
    })
  );
});

test("create rejects an over/under pick on a game with no published total", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "ou_unpriced-game": "Over|N/A" },
    })
  );
});

// ---- Update ----

test("update: unchanged value for an already-started game succeeds (pickUnchanged carry-forward)", async () => {
  await seedMatchups();
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: { "spread_started-game": "Team C|-7" },
  });
  await assertSucceeds(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_started-game": "Team C|-7" },
    })
  );
});

test("update: changed value for an already-started game is rejected", async () => {
  await seedMatchups();
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: { "spread_started-game": "Team C|-7" },
  });
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_started-game": "Team D|+7" },
    })
  );
});

// ---- lockedPick ----

test("create with lockedPick pointing at a real key in picks succeeds", async () => {
  await seedMatchups();
  await assertSucceeds(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_future-game": "Team A|+3" },
      lockedPick: "spread_future-game",
    })
  );
});

test("create with lockedPick pointing at a key not in picks is rejected", async () => {
  await seedMatchups();
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: { "spread_future-game": "Team A|+3" },
      lockedPick: "spread_bogus",
    })
  );
});

test("once the locked pick's matchup has started, changing lockedPick to a different key is rejected", async () => {
  await seedMatchups();
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: {
      "spread_started-game": "Team C|-7",
      "spread_future-game": "Team A|+3",
    },
    lockedPick: "spread_started-game",
  });
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: {
        "spread_started-game": "Team C|-7",
        "spread_future-game": "Team A|+3",
      },
      lockedPick: "spread_future-game",
    })
  );
});

test("resubmitting the same frozen lockedPick value succeeds", async () => {
  await seedMatchups();
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: {
      "spread_started-game": "Team C|-7",
      "spread_future-game": "Team A|+3",
    },
    lockedPick: "spread_started-game",
  });
  await assertSucceeds(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "alice",
      picks: {
        "spread_started-game": "Team C|-7",
        "spread_future-game": "Team A|+3",
      },
      lockedPick: "spread_started-game",
    })
  );
});

// ---- Delete ----

test("delete is always rejected", async () => {
  await seedPickDoc("alice_week1_2026", {
    userId: "alice",
    picks: {},
  });
  await assertFails(deleteDoc(doc(aliceDb(), "picks/alice_week1_2026")));
});
