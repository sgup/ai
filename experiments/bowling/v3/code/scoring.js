// scoring.js — Pure ten-pin bowling scoring logic.
// No DOM, no rendering. Deterministic and unit-testable.
//
// Data model:
//   A game is an array of up to 10 frames.
//   Each frame: { rolls: number[], score: number|null, cumulative: number|null }
//   `rolls` holds pins knocked down per ball in that frame (0..10).
//   Frames 1-9 have 1 or 2 rolls (1 if a strike). Frame 10 has 2 or 3 rolls.
//
// This module is intentionally framework-free so its correctness can be read
// straight off the page and checked with a tiny harness (see scoring.test.js).

export const TOTAL_FRAMES = 10;
export const PINS = 10;

export function createGame() {
  const frames = [];
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    frames.push({ rolls: [], score: null, cumulative: null });
  }
  return {
    frames,
    currentFrame: 0, // 0-indexed frame in progress
    currentRoll: 0, // roll index within the current frame
    complete: false,
  };
}

// Is the given (0-indexed) frame a strike? (first ball knocks all 10)
function isStrike(frame) {
  return frame.rolls.length >= 1 && frame.rolls[0] === PINS;
}

// Is the given frame a spare? (two balls sum to 10, first wasn't a strike)
function isSpare(frame) {
  return (
    frame.rolls.length >= 2 &&
    frame.rolls[0] !== PINS &&
    frame.rolls[0] + frame.rolls[1] === PINS
  );
}

// How many pins are still standing for the *current* ball in a frame.
// Used to validate input and to know how many pins to render.
export function pinsStandingForCurrentBall(game) {
  const f = game.frames[game.currentFrame];
  if (!f) return 0;
  const isLast = game.currentFrame === TOTAL_FRAMES - 1;

  if (!isLast) {
    // Frames 1-9: if first ball was a strike the frame is over (handled by advance).
    if (game.currentRoll === 0) return PINS;
    return PINS - f.rolls[0];
  }

  // 10th frame: pins reset after a strike or spare clears the rack.
  const r = f.rolls;
  if (game.currentRoll === 0) return PINS;
  if (game.currentRoll === 1) {
    if (r[0] === PINS) return PINS; // fresh rack after a strike
    return PINS - r[0];
  }
  // third ball
  if (r[0] === PINS && r[1] === PINS) return PINS; // two strikes -> fresh rack
  if (r[0] === PINS) return PINS - r[1]; // strike then partial -> remainder of 2nd rack
  // first two were a spare -> fresh rack for bonus ball
  return PINS;
}

// Record a roll. `pins` = pins knocked down on this ball.
// Returns an object describing what happened so the UI can react:
//   { frameComplete, gameComplete, wasStrike, wasSpare, rackReset }
export function roll(game, pins) {
  if (game.complete) return { frameComplete: false, gameComplete: true };

  const fi = game.currentFrame;
  const f = game.frames[fi];
  const isLast = fi === TOTAL_FRAMES - 1;
  pins = Math.max(0, Math.min(PINS, Math.round(pins)));

  f.rolls.push(pins);

  let frameComplete = false;
  let rackReset = false;
  const wasStrike = pins === PINS && game.currentRoll === 0;

  if (!isLast) {
    // Frames 1-9
    if (pins === PINS && game.currentRoll === 0) {
      // strike -> frame over
      frameComplete = true;
    } else if (game.currentRoll === 1) {
      frameComplete = true;
    } else {
      game.currentRoll = 1;
    }

    if (frameComplete) {
      game.currentFrame += 1;
      game.currentRoll = 0;
    }
  } else {
    // 10th frame logic
    const r = f.rolls;
    if (game.currentRoll === 0) {
      game.currentRoll = 1;
      if (pins === PINS) rackReset = true; // strike clears rack for ball 2
    } else if (game.currentRoll === 1) {
      // Decide whether a third ball is earned.
      const earnedThird = r[0] === PINS || r[0] + r[1] === PINS;
      if (earnedThird) {
        game.currentRoll = 2;
        // rack resets if strike on ball1, or spare just completed, or strike on ball2
        rackReset = r[0] === PINS ? r[1] === PINS : true;
      } else {
        frameComplete = true;
      }
    } else {
      // third ball always ends the game
      frameComplete = true;
    }

    if (frameComplete) {
      game.complete = true;
    }
  }

  recompute(game);

  const wasSpare =
    !wasStrike && f.rolls.length >= 2 && isSpare(f) && game.currentRoll <= 1;

  return {
    frameComplete,
    gameComplete: game.complete,
    wasStrike,
    wasSpare,
    rackReset,
  };
}

// Flatten all rolls across frames into a single sequence so strike/spare
// bonuses can look "ahead" to subsequent balls regardless of frame boundaries.
function flatRolls(frames) {
  const flat = [];
  // Map: frameIndex -> starting position in flat array
  const frameStart = [];
  for (let i = 0; i < frames.length; i++) {
    frameStart[i] = flat.length;
    for (const r of frames[i].rolls) flat.push(r);
  }
  return { flat, frameStart };
}

// Recompute per-frame scores + running totals for everything scorable so far.
export function recompute(game) {
  const frames = game.frames;
  const { flat, frameStart } = flatRolls(frames);
  let running = 0;

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const f = frames[i];
    if (f.rolls.length === 0) {
      f.score = null;
      f.cumulative = null;
      continue;
    }

    const isLast = i === TOTAL_FRAMES - 1;
    let frameScore = null;

    if (isLast) {
      // 10th frame: only scorable once its rolls are settled.
      const need = tenthFrameRollsNeeded(f);
      if (f.rolls.length >= need) {
        frameScore = f.rolls.reduce((a, b) => a + b, 0);
      }
    } else if (isStrike(f)) {
      // Need next two balls.
      const start = frameStart[i];
      const b1 = flat[start + 1];
      const b2 = flat[start + 2];
      if (b1 !== undefined && b2 !== undefined) {
        frameScore = PINS + b1 + b2;
      }
    } else if (isSpare(f)) {
      // Need next one ball.
      const start = frameStart[i];
      const b1 = flat[start + 2];
      if (b1 !== undefined) {
        frameScore = PINS + b1;
      }
    } else if (f.rolls.length >= 2) {
      frameScore = f.rolls[0] + f.rolls[1];
    }

    f.score = frameScore;
    if (frameScore === null) {
      f.cumulative = null;
    } else {
      running += frameScore;
      f.cumulative = running;
    }
  }
}

// How many rolls the 10th frame ultimately needs.
function tenthFrameRollsNeeded(f) {
  if (f.rolls.length === 0) return 2;
  if (f.rolls[0] === PINS) return 3; // strike -> 3 balls
  if (f.rolls.length >= 2 && f.rolls[0] + f.rolls[1] === PINS) return 3; // spare -> 3
  return 2;
}

// Best-known total so far (last cumulative that's been computed).
export function totalScore(game) {
  let total = 0;
  for (const f of game.frames) {
    if (f.cumulative !== null) total = f.cumulative;
  }
  return total;
}
