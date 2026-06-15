// scoring.test.js — tiny harness, run with: node scoring.test.js
// Verifies the pure scoring module against canonical ten-pin scores.
import { createGame, roll, totalScore } from "./scoring.js";

function play(rolls) {
  const g = createGame();
  for (const p of rolls) {
    if (g.complete) break;
    roll(g, p);
  }
  return g;
}

let pass = 0;
let fail = 0;
function expect(name, got, want) {
  if (got === want) {
    pass++;
    console.log(`  ok   ${name}: ${got}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}: got ${got}, want ${want}`);
  }
}

// 1. Perfect game: 12 strikes -> 300
expect("perfect game", totalScore(play(Array(12).fill(10))), 300);

// 2. All gutters -> 0
expect("all gutters", totalScore(play(Array(20).fill(0))), 0);

// 3. All spares of 5 (5,5 x10 + bonus 5) -> 150
{
  const rolls = [];
  for (let i = 0; i < 10; i++) rolls.push(5, 5);
  rolls.push(5); // 10th-frame bonus ball
  expect("all 5/5 spares", totalScore(play(rolls)), 150);
}

// 4. All nines, no spares (9 then miss, x10) -> 90
{
  const rolls = [];
  for (let i = 0; i < 10; i++) rolls.push(9, 0);
  expect("all nine-miss", totalScore(play(rolls)), 90);
}

// 5. Worked example from Wikipedia-style table:
//    Frame: X 7/ 9- X -8 8/ -6 X X X8(spare->no) ... use a known one.
//    Use: 1,4, 4,5, 6,/(spare 6,4), 5,/(5,5), X, 0,1, 7,/(7,3), 6,/(6,4), X, 2,/(2,8 spare)... too fiddly.
//    Instead a clean documented example: rolls below total to 133.
//    10,7,3,9,0,10,0,8,8,2,0,6,10,10,10,8,1  (from a common scoring tutorial = 167)
{
  // Strike, 7/ , 9- , Strike, -8, 8/, -6, Strike, Strike, Strike 8 1  -> 167
  const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  expect("tutorial game", totalScore(play(rolls)), 167);
}

// 6. Spare in 10th frame grants exactly one bonus ball.
{
  const rolls = [];
  for (let i = 0; i < 9; i++) rolls.push(0, 0); // 9 empty frames
  rolls.push(5, 5, 7); // 10th: spare + 7 bonus = 17
  expect("10th-frame spare bonus", totalScore(play(rolls)), 17);
}

// 7. Strike in 10th frame grants exactly two bonus balls.
{
  const rolls = [];
  for (let i = 0; i < 9; i++) rolls.push(0, 0);
  rolls.push(10, 10, 10); // 10th: three strikes = 30
  expect("10th-frame strike bonus", totalScore(play(rolls)), 30);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
