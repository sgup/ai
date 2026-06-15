// Plain Node test for the scoring engine. Run: node js/scoring.test.mjs
import { createGame, roll, totalScore, frameScores, rollSymbol } from "./scoring.js";

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

function rollMany(g, arr) { for (const p of arr) roll(g, p); return g; }

// Gutter game = 0
{
  const g = createGame();
  rollMany(g, new Array(20).fill(0));
  check("gutter total", totalScore(g), 0);
}

// All ones = 20
{
  const g = createGame();
  rollMany(g, new Array(20).fill(1));
  check("all ones", totalScore(g), 20);
}

// Perfect game = 300 (12 strikes)
{
  const g = createGame();
  rollMany(g, new Array(12).fill(10));
  check("perfect 300", totalScore(g), 300);
}

// One spare then 3 then zeros: spare frame = 10 + 3 = 13, next frame 3, total 16
{
  const g = createGame();
  rollMany(g, [5, 5, 3, 0]);
  rollMany(g, new Array(16).fill(0));
  check("spare bonus", totalScore(g), 16);
}

// One strike then 3 and 4: strike frame = 10+3+4=17, next = 7 => 24
{
  const g = createGame();
  rollMany(g, [10, 3, 4]);
  rollMany(g, new Array(16).fill(0));
  check("strike bonus", totalScore(g), 24);
}

// Classic example game from Wikipedia-style: alternating to a known total.
// 9/ in every frame, then strike fill in 10th: 10 frames of spare-with-9-bonus.
{
  const g = createGame();
  // frames 1-9: 9 then spare(1). 10th: 9, spare, strike fill.
  for (let i = 0; i < 9; i++) rollMany(g, [9, 1]);
  rollMany(g, [9, 1, 10]); // 10th frame: 9 + spare, fill ball strike
  // Each of frames 1-9 = 10 + next first ball (9) = 19 => 171; 10th = 9+1+10=20 => 191
  check("all nines spares", totalScore(g), 191);
}

// 10th frame: strike + strike + strike = 30 added
{
  const g = createGame();
  rollMany(g, new Array(18).fill(0)); // 9 open frames of 0,0
  rollMany(g, [10, 10, 10]);
  check("tenth triple strike", totalScore(g), 30);
}

// 10th frame spare then bonus ball
{
  const g = createGame();
  rollMany(g, new Array(18).fill(0));
  rollMany(g, [7, 3, 5]); // spare + 5 bonus
  check("tenth spare bonus", totalScore(g), 15);
}

// Symbols
{
  const g = createGame();
  rollMany(g, [10]); // strike frame 1
  check("symbol strike", rollSymbol(g, 0, 0), "X");
  rollMany(g, [7, 3]); // spare frame 2
  check("symbol spare", rollSymbol(g, 1, 1), "/");
  check("symbol seven", rollSymbol(g, 1, 0), "7");
  rollMany(g, [0]);
  check("symbol gutter", rollSymbol(g, 2, 0), "-");
}

// frameScores: open running totals
{
  const g = createGame();
  rollMany(g, [1, 2, 3, 4]);
  const s = frameScores(g);
  check("running f1", s[0], 3);
  check("running f2", s[1], 10);
  check("f3 null", s[2], null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
