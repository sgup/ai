/* Headless tests for the scoring engine. Run: node scoring.test.js */
const B = require("./scoring.js");

let pass = 0;
let fail = 0;
const failures = [];

function eq(actual, expected, name) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}: expected ${expected}, got ${actual}`);
  }
}

function rollMany(game, arr) {
  for (const p of arr) B.roll(game, p);
  return game;
}

// 1. Perfect game = 300.
{
  const g = B.createGame();
  rollMany(g, Array(12).fill(10));
  eq(B.settledTotal(g), 300, "perfect game total");
  eq(g.over, true, "perfect game over");
  eq(g.frames[9].rolls.length, 3, "10th frame has 3 rolls on perfect");
}

// 2. All gutters = 0.
{
  const g = B.createGame();
  rollMany(g, Array(20).fill(0));
  eq(B.settledTotal(g), 0, "all gutters total");
  eq(g.over, true, "all gutters over");
}

// 3. All nines, miss spare (9 then 0 each frame) = 90.
{
  const g = B.createGame();
  for (let i = 0; i < 10; i++) rollMany(g, [9, 0]);
  eq(B.settledTotal(g), 90, "all-nines-open total");
}

// 4. All spares with 5s, plus a 5 bonus = 150.
{
  const g = B.createGame();
  for (let i = 0; i < 10; i++) rollMany(g, [5, 5]);
  B.roll(g, 5); // 10th-frame bonus ball
  eq(B.settledTotal(g), 150, "all-spares-5 total");
  eq(g.over, true, "all spares over");
}

// 5. Classic mixed game = known 133.
//   Wikipedia example: rolls below sum to 133.
{
  const g = B.createGame();
  // frame:        1    2    3     4    5    6    7    8    9     10
  rollMany(g, [1,4, 4,5, 6,4, 5,5, 10, 0,1, 7,3, 6,4, 10, 2,8,6]);
  eq(B.settledTotal(g), 133, "mixed game (133)");
  eq(g.over, true, "mixed game over");
}

// 6. Strike then open: strike(10) + 4 + 5 = 19 for frame 1, then 9 = 28.
{
  const g = B.createGame();
  rollMany(g, [10, 4, 5]);
  eq(g.frames[0].score, 19, "strike+bonus score");
  eq(g.frames[1].score, 9, "open after strike score");
  eq(B.settledTotal(g), 28, "strike then open cumulative");
}

// 7. Spare then strike: frame1 spare(10) + next roll(10) = 20.
{
  const g = B.createGame();
  rollMany(g, [7, 3, 10, 0, 0]);
  eq(g.frames[0].score, 20, "spare + strike bonus");
}

// 8. pinsAvailable correctness.
{
  const g = B.createGame();
  eq(B.pinsAvailable(g), 10, "fresh rack avail = 10");
  B.roll(g, 3);
  eq(B.pinsAvailable(g), 7, "after 3, avail = 7");
  B.roll(g, 4);
  eq(B.pinsAvailable(g), 10, "new frame avail = 10");
}

// 9. Strike does not consume second ball in frames 1-9.
{
  const g = B.createGame();
  B.roll(g, 10);
  eq(g.currentFrame, 1, "strike advances frame");
  eq(g.frames[0].rolls.length, 1, "strike = single roll recorded");
}

// 10. 10th-frame spare grants exactly one bonus ball.
{
  const g = B.createGame();
  for (let i = 0; i < 9; i++) rollMany(g, [0, 0]);
  rollMany(g, [4, 6]); // spare in 10th
  eq(g.over, false, "10th spare not over yet");
  B.roll(g, 5);
  eq(g.over, true, "10th spare over after bonus");
  eq(g.frames[9].score, 15, "10th spare frame score");
}

// 11. Over-throw is clamped to available pins.
{
  const g = B.createGame();
  B.roll(g, 7);
  B.roll(g, 99); // can only knock 3
  eq(g.frames[0].rolls[1], 3, "overthrow clamped to remaining");
}

// 12. Labels: strike, spare, gutter glyphs.
{
  const g = B.createGame();
  B.roll(g, 10);
  eq(B.labelForRoll(g, 0, 0, 10), "X", "label strike");
  const g2 = B.createGame();
  B.roll(g2, 4);
  B.roll(g2, 6);
  eq(B.labelForRoll(g2, 0, 1, 6), "/", "label spare");
  eq(B.labelForRoll(g2, 0, 0, 0), "-", "label gutter (recomputed value)");
}

console.log(`\nScoring tests: ${pass} passed, ${fail} failed.`);
if (fail) {
  console.log("Failures:\n  " + failures.join("\n  "));
  process.exit(1);
}
process.exit(0);
