/**
 * scoring.js — Ten-pin bowling scoring engine.
 *
 * Implements full, correct ten-pin scoring including strike/spare bonuses
 * and the special rules of the 10th frame (up to 3 rolls). The scorer keeps
 * an ordered list of rolls (pin counts) and derives per-frame and cumulative
 * scores from them. This separation keeps the 3D/physics code free of any
 * scoring logic.
 */

export const TOTAL_FRAMES = 10;
export const TOTAL_PINS = 10;

export class BowlingGame {
  constructor() {
    this.reset();
  }

  reset() {
    /** Flat list of every roll's pin count, in order. */
    this.rolls = [];
    this.frameIndex = 0; // 0..9
    this.rollInFrame = 0; // which throw within the current frame
    this.pinsStandingInFrame = TOTAL_PINS;
    this.complete = false;
    this._frameStartRollIdx = [0]; // index into rolls[] where each frame begins
  }

  /** Is the game currently waiting for the first ball of a frame? */
  isFirstBallOfFrame() {
    return this.rollInFrame === 0;
  }

  get currentFrame() {
    return this.frameIndex;
  }

  /** Pins still standing on the lane for the active throw. */
  get pinsRemaining() {
    return this.pinsStandingInFrame;
  }

  /**
   * Record a throw that knocked down `pins` pins.
   * Returns an object describing what just happened so the UI can react.
   */
  roll(pins) {
    if (this.complete) return { ignored: true };
    pins = Math.max(0, Math.min(pins, this.pinsStandingInFrame));

    this.rolls.push(pins);
    const isTenth = this.frameIndex === TOTAL_FRAMES - 1;

    const result = {
      frame: this.frameIndex,
      pins,
      isStrike: false,
      isSpare: false,
      frameComplete: false,
      gameComplete: false,
      resetPins: false, // should all 10 pins be re-racked for the next throw?
    };

    if (!isTenth) {
      this._handleNormalFrame(pins, result);
    } else {
      this._handleTenthFrame(pins, result);
    }

    return result;
  }

  _handleNormalFrame(pins, result) {
    if (this.rollInFrame === 0) {
      if (pins === TOTAL_PINS) {
        // Strike — frame over, re-rack all pins.
        result.isStrike = true;
        result.frameComplete = true;
        result.resetPins = true;
        this._advanceFrame();
      } else {
        this.pinsStandingInFrame -= pins;
        this.rollInFrame = 1;
      }
    } else {
      // Second ball.
      const firstBall = TOTAL_PINS - this.pinsStandingInFrame;
      if (firstBall + pins === TOTAL_PINS) {
        result.isSpare = true;
      }
      result.frameComplete = true;
      result.resetPins = true;
      this._advanceFrame();
    }
  }

  _handleTenthFrame(pins, result) {
    const f = this._frameStartRollIdx[TOTAL_FRAMES - 1];
    const tenthRolls = this.rolls.slice(f);
    const n = tenthRolls.length;

    if (n === 1) {
      if (pins === TOTAL_PINS) {
        result.isStrike = true;
        result.resetPins = true;
        this.pinsStandingInFrame = TOTAL_PINS;
      } else {
        this.pinsStandingInFrame -= pins;
      }
      this.rollInFrame = 1;
    } else if (n === 2) {
      const [a, b] = tenthRolls;
      if (a === TOTAL_PINS) {
        // After an opening strike, the second ball is a fresh rack.
        if (b === TOTAL_PINS) {
          result.isStrike = true;
        }
        result.resetPins = true;
        this.pinsStandingInFrame = TOTAL_PINS - (b === TOTAL_PINS ? 0 : b);
        if (b === TOTAL_PINS) this.pinsStandingInFrame = TOTAL_PINS;
        this.rollInFrame = 2;
      } else if (a + b === TOTAL_PINS) {
        // Spare — earns a third ball with a fresh rack.
        result.isSpare = true;
        result.resetPins = true;
        this.pinsStandingInFrame = TOTAL_PINS;
        this.rollInFrame = 2;
      } else {
        // Open frame — game ends after two balls.
        this.pinsStandingInFrame -= pins;
        result.frameComplete = true;
        result.gameComplete = true;
        this.complete = true;
      }
    } else {
      // Third (bonus) ball — always ends the game.
      const [a] = tenthRolls;
      if (pins === TOTAL_PINS) result.isStrike = true;
      // (No spare flag possible to score on a bonus ball here.)
      result.frameComplete = true;
      result.gameComplete = true;
      this.complete = true;
    }
  }

  _advanceFrame() {
    this.frameIndex += 1;
    this.rollInFrame = 0;
    this.pinsStandingInFrame = TOTAL_PINS;
    if (this.frameIndex < TOTAL_FRAMES) {
      this._frameStartRollIdx[this.frameIndex] = this.rolls.length;
    }
  }

  /**
   * Compute per-frame and cumulative scores from the flat roll list.
   * Returns an array of 10 frame descriptors; bonus-dependent frames whose
   * bonus rolls haven't happened yet are left with `cumulative: null`.
   */
  getScorecard() {
    const frames = [];
    const r = this.rolls;
    let i = 0;
    let running = 0;
    let runningValid = true;

    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const frame = { rolls: [], symbols: [], score: null, cumulative: null };

      if (i >= r.length) {
        frames.push(frame);
        continue;
      }

      if (f < TOTAL_FRAMES - 1) {
        if (r[i] === TOTAL_PINS) {
          // Strike.
          frame.rolls = [r[i]];
          frame.symbols = ["", "X"]; // displayed in the second box
          const bonus = (r[i + 1] ?? null) !== null && (r[i + 2] ?? null) !== null
            ? r[i + 1] + r[i + 2]
            : null;
          if (bonus !== null) {
            frame.score = 10 + bonus;
          }
          i += 1;
        } else {
          const a = r[i];
          const b = r[i + 1];
          frame.rolls = b === undefined ? [a] : [a, b];
          frame.symbols = [symFirst(a), b === undefined ? "" : symSecond(a, b)];
          if (b !== undefined) {
            if (a + b === TOTAL_PINS) {
              // Spare.
              const bonus = r[i + 2];
              if (bonus !== undefined) frame.score = 10 + bonus;
            } else {
              frame.score = a + b;
            }
            i += 2;
          }
          // else: frame incomplete, leave score null and stop consuming.
        }
      } else {
        // 10th frame: consume up to 3 rolls.
        const tenth = r.slice(i);
        frame.rolls = tenth;
        frame.symbols = tenthSymbols(tenth);
        const needed = tenthRollsNeeded(tenth);
        if (tenth.length >= needed && needed > 0) {
          frame.score = tenth.reduce((s, x) => s + x, 0);
        }
        i = r.length;
      }

      if (frame.score !== null && runningValid) {
        running += frame.score;
        frame.cumulative = running;
      } else if (frame.score === null) {
        runningValid = false;
      } else {
        running += frame.score;
        frame.cumulative = running;
      }

      frames.push(frame);
    }
    return frames;
  }

  /** Best known total (sums every frame that currently has a score). */
  getTotal() {
    return this.getScorecard().reduce((s, f) => s + (f.score ?? 0), 0);
  }
}

function symFirst(a) {
  if (a === 0) return "-";
  return String(a);
}
function symSecond(a, b) {
  if (b === 0) return "-";
  if (a + b === TOTAL_PINS) return "/";
  return String(b);
}
function tenthSymbols(rolls) {
  const out = [];
  let standing = TOTAL_PINS;
  for (let k = 0; k < rolls.length; k++) {
    const p = rolls[k];
    if (p === TOTAL_PINS && standing === TOTAL_PINS) {
      out.push("X");
      standing = TOTAL_PINS; // re-rack
    } else if (k > 0 && standing - p === 0 && out[k - 1] !== "X") {
      out.push("/");
      standing = TOTAL_PINS;
    } else {
      out.push(p === 0 ? "-" : String(p));
      standing -= p;
      if (standing <= 0) standing = TOTAL_PINS;
    }
  }
  return out;
}
function tenthRollsNeeded(rolls) {
  if (rolls.length === 0) return 3;
  const [a, b] = rolls;
  if (a === TOTAL_PINS) return 3; // strike → 3 balls
  if (b !== undefined && a + b === TOTAL_PINS) return 3; // spare → 3 balls
  return 2; // open frame
}
