const { before, after, afterEach, test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");

let testEnv;

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

async function seedMatchup() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "matchups/game1"), {
      away: "Team A",
      home: "Team B",
      awayLine: "+3",
      homeLine: "-3",
      overUnder: "44.5",
      commenceTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      weekStr: "week1",
      yearStr: "2026",
    });
  });
}

// Matches the shape update_leaderboard.py actually writes: player
// entries nested under `players`, alongside a `computedAt` timestamp
// that record.js surfaces to explain how stale the points are.
async function seedLeaderboard() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "leaderboard/current"), {
      players: {
        alice: { name: "Alice", points: 12, w: 4, l: 1, p: 0 },
      },
      computedAt: new Date(),
    });
  });
}

test("unauthenticated users can read /matchups/{gameId}", async () => {
  await seedMatchup();
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "matchups/game1")));
});

test("no client, even authenticated, can write /matchups/{gameId}", async () => {
  await seedMatchup();
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertFails(
    setDoc(doc(db, "matchups/game1"), { away: "Hacked Team" })
  );
});

test("unauthenticated users can read /leaderboard/{docId}", async () => {
  await seedLeaderboard();
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "leaderboard/current")));
});

test("no client, even authenticated, can write /leaderboard/{docId}", async () => {
  await seedLeaderboard();
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertFails(
    setDoc(doc(db, "leaderboard/current"), { alice: { points: 9999 } })
  );
});

