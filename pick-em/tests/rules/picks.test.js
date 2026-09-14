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

test("create rejects a pickId not matching the caller's own uid_weekN_year", async () => {
  await assertFails(
    setDoc(doc(aliceDb(), "picks/bob_week1_2026"), {
      userId: "alice",
      picks: {},
    })
  );
});

test("create rejects a userId field mismatched from request.auth.uid", async () => {
  await assertFails(
    setDoc(doc(aliceDb(), "picks/alice_week1_2026"), {
      userId: "bob",
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
