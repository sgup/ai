// Ten-pin bowling scoring engine.
// A frame holds the rolls (pin counts) thrown in that frame.
// Standard frames (1-9): 1 or 2 rolls. 10th frame: up to 3 rolls.
//
// This module is pure: feed it rolls, ask it for frame scores. No rendering.

export const TOTAL_FRAMES = 10;
export const PINS = 10;

export function createGame() {
  return {
    frames: Array.from({ length: TOTAL_FRAMES }, () => ({ rolls: [] })),
    currentFrame: 0, // 0-indexed
    over: false,
  };
}

// How many pins are standing at the start of the current ball within a frame.
// Returns the number of pins available to knock down for the *next* roll.
export function pinsAvailable(game) {
  const frame = game.frames[game.currentFrame];
  const isTenth = game.currentFrame === TOTAL_FRAMES - 1;
  const rolls = frame.rolls;

  if (!isTenth) {
    // Frames 1-9: after a strike the frame is done; otherwise 10 - first ball.
    if (rolls.length === 0) return PINS;
    return PINS - rolls[0];
  }

  // 10th frame logic.
  if (rolls.length === 0) return PINS;
  if (rolls.length === 1) {
    if (rolls[0] === PINS) return PINS; // strike -> fresh rack
    return PINS - rolls[0];
  }
  if (rolls.length === 2) {
    const sum = rolls[0] + rolls[1];
    if (rolls[0] === PINS) {
      // first was a strike; second ball was on a fresh rack
      return rolls[1] === PINS ? PINS : PINS - rolls[1];
    }
    if (sum === PINS) return PINS; // spare -> fresh rack for bonus ball
    return 0; // open frame, no third ball
  }
  return 0;
}

// Whether the player gets another ball in the current frame after this roll.
function frameContinues(game) {
  const frame = game.frames[game.currentFrame];
  const isTenth = game.currentFrame === TOTAL_FRAMES - 1;
  const rolls = frame.rolls;

  if (!isTenth) {
    if (rolls.length === 0) return true;
    if (rolls.length === 1) return rolls[0] < PINS; // strike ends frame early
    return false;
  }

  // 10th frame: you get a 3rd ball only with a strike or spare in first two.
  if (rolls.length === 1) return true;
  if (rolls.length === 2) {
    const earnedThird = rolls[0] === PINS || rolls[0] + rolls[1] === PINS;
    return earnedThird;
  }
  return false;
}

// Record a roll of `pins` knocked down. Returns an event describing what happened.
export function roll(game, pins) {
  if (game.over) return { type: "gameOver" };
  const frame = game.frames[game.currentFrame];
  frame.rolls.push(pins);

  const continues = frameContinues(game);
  if (continues) {
    return { type: "nextBall", frame: game.currentFrame };
  }

  // Frame complete; advance.
  if (game.currentFrame === TOTAL_FRAMES - 1) {
    game.over = true;
    return { type: "gameOver" };
  }
  game.currentFrame += 1;
  return { type: "nextFrame", frame: game.currentFrame };
}

// Flatten all rolls across frames in throw order (for bonus lookahead).
function flatRolls(game) {
  const flat = [];
  game.frames.forEach((f, fi) => {
    f.rolls.forEach((r, ri) => flat.push({ pins: r, frame: fi, idx: ri }));
  });
  return flat;
}

// Cumulative score per frame. Unscorable frames (waiting on bonus balls) are null.
export function frameScores(game) {
  const scores = new Array(TOTAL_FRAMES).fill(null);
  const flat = flatRolls(game);

  // Build a per-frame mapping of where its rolls start in the flat list.
  const frameStart = [];
  let cursor = 0;
  for (let f = 0; f < TOTAL_FRAMES; f++) {
    frameStart[f] = cursor;
    cursor += game.frames[f].rolls.length;
  }

  let running = 0;
  for (let f = 0; f < TOTAL_FRAMES; f++) {
    const rolls = game.frames[f].rolls;
    if (rolls.length === 0) break;
    const start = frameStart[f];

    let frameTotal = null;

    if (f < TOTAL_FRAMES - 1) {
      const isStrike = rolls[0] === PINS;
      const isSpare = !isStrike && rolls.length >= 2 && rolls[0] + rolls[1] === PINS;

      if (isStrike) {
        // need next two rolls
        const b1 = flat[start + 1];
        const b2 = flat[start + 2];
        if (b1 && b2) frameTotal = PINS + b1.pins + b2.pins;
      } else if (isSpare) {
        const b1 = flat[start + 2];
        if (b1) frameTotal = PINS + b1.pins;
      } else if (rolls.length >= 2) {
        frameTotal = rolls[0] + rolls[1];
      }
    } else {
      // 10th frame: just sum its own rolls once it's complete.
      const complete = isTenthComplete(rolls);
      if (complete) frameTotal = rolls.reduce((a, b) => a + b, 0);
    }

    if (frameTotal === null) {
      // can't score this frame yet; nothing after it can be scored either
      break;
    }
    running += frameTotal;
    scores[f] = running;
  }

  return scores;
}

function isTenthComplete(rolls) {
  if (rolls.length < 2) return false;
  const earnedThird = rolls[0] === PINS || rolls[0] + rolls[1] === PINS;
  if (earnedThird) return rolls.length === 3;
  return rolls.length === 2;
}

export function totalScore(game) {
  const scores = frameScores(game);
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i] !== null) return scores[i];
  }
  return 0;
}

// Symbol for a given roll in a given frame, for the scoreboard cells (X, /, -, n).
export function rollSymbol(game, frameIdx, rollIdx) {
  const rolls = game.frames[frameIdx].rolls;
  if (rollIdx >= rolls.length) return "";
  const pins = rolls[rollIdx];
  const isTenth = frameIdx === TOTAL_FRAMES - 1;

  if (!isTenth) {
    if (rollIdx === 0) {
      if (pins === PINS) return "X";
      return pins === 0 ? "-" : String(pins);
    }
    // second roll
    if (rolls[0] + pins === PINS) return "/";
    return pins === 0 ? "-" : String(pins);
  }

  // 10th frame symbols
  if (rollIdx === 0) {
    if (pins === PINS) return "X";
    return pins === 0 ? "-" : String(pins);
  }
  if (rollIdx === 1) {
    if (rolls[0] === PINS) {
      // fresh rack
      if (pins === PINS) return "X";
      return pins === 0 ? "-" : String(pins);
    }
    if (rolls[0] + pins === PINS) return "/";
    return pins === 0 ? "-" : String(pins);
  }
  // rollIdx === 2
  if (pins === PINS) return "X";
  // could be a spare on bonus balls
  if (rolls[1] !== PINS && rolls[0] !== PINS && false) return "";
  // if second ball wasn't a strike and first two on fresh rack formed a spare
  if (rolls[0] === PINS && rolls[1] !== PINS && rolls[1] + pins === PINS) return "/";
  return pins === 0 ? "-" : String(pins);
}
