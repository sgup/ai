/**
 * main.js — Game orchestrator.
 *
 * Wires together the renderer (scene.js), the physics simulator (physics.js),
 * the scoring engine (scoring.js), input (input.js) and the HUD (ui.js), and
 * drives the fixed-step game loop plus a small state machine:
 *
 *   AIMING → ROLLING → SETTLING → (next ball | next frame | game over)
 *
 * Camera, banners and pin re-racking all hang off these transitions.
 */

import { BowlingScene, BALL_COLORS } from "./scene.js";
import { BowlingPhysics, LANE, BALL_RADIUS } from "./physics.js";
import { BowlingGame } from "./scoring.js";
import { InputController } from "./input.js";
import { GameUI } from "./ui.js";

const State = {
  AIMING: "AIMING",
  ROLLING: "ROLLING",
  SETTLING: "SETTLING",
  RESETTING: "RESETTING",
  GAMEOVER: "GAMEOVER",
};

class BowlingApp {
  constructor() {
    this.canvas = document.getElementById("scene");
    this.scene = new BowlingScene(this.canvas);
    this.physics = new BowlingPhysics();
    this.game = new BowlingGame();
    this.ui = new GameUI();

    this.state = State.AIMING;
    this.ballColorIndex = 0;
    this.pinsBeforeRoll = 10;
    this.resetTimer = 0;

    this.input = new InputController(this.canvas, {
      onAim: (aim, spin) => this._onAim(aim, spin),
      onCharge: (power, aim, spin) => this._onCharge(power, aim, spin),
      onRelease: (shot) => this._onRelease(shot),
    });

    this.ui.onStart(() => this._startGame());
    this.ui.onReplay(() => this._startGame());
    this.ui.onPickBall((i) => {
      this.ballColorIndex = i;
      this.scene.setBallColor(BALL_COLORS[i]);
    });

    this.currentAim = 0;
    this.currentSpin = 0;

    this.last = performance.now();
    this.acc = 0;
    this.fixedDt = 1 / 120;

    this._loop = this._loop.bind(this);
  }

  init() {
    // First render + show the start screen once the GPU is warm.
    this.scene.syncPins(this.physics.pins);
    this.scene.syncBall(this.physics.ball);
    this.scene.render(0.016);
    requestAnimationFrame(() => {
      this.ui.hideLoading();
      this.ui.showStart();
      requestAnimationFrame(this._loop);
    });
  }

  _startGame() {
    this.ui.hideStart();
    this.ui.hideGameOver();
    this.game.reset();
    this.physics.rackFull();
    this.physics.resetBall(0);
    this.state = State.AIMING;
    this.pinsBeforeRoll = 0;
    this.currentAim = 0;
    this.currentSpin = 0;
    this.scene.setBallColor(BALL_COLORS[this.ballColorIndex]);
    this.scene.setCameraBowler();
    this.ui.showGame();
    this.ui.resetPower();
    this.ui.setHint("Drag the ball back & release to bowl. Move to aim.");
    this._refreshScoreboard();
    this.input.enable();
    this._positionBallForAim(0);
    this.scene.showAim(0, 0, 0);
  }

  // ---------- Input handlers ----------
  _onAim(aim, spin) {
    if (this.state !== State.AIMING) return;
    this.currentAim = aim;
    const x = aim * (LANE.width / 2 - BALL_RADIUS - 0.02);
    this._positionBallForAim(x);
    this.scene.showAim(x, aim * 0.06, this.currentSpin);
    this.ui.updateAim(aim, this.currentSpin);
  }

  _onCharge(power, aim, spin) {
    if (this.state !== State.AIMING) return;
    this.currentAim = aim;
    this.currentSpin = spin;
    const x = aim * (LANE.width / 2 - BALL_RADIUS - 0.02);
    this._positionBallForAim(x);
    this.scene.showAim(x, aim * 0.06, spin);
    this.ui.updateCharge(power, aim, spin);
    this.ui.setHint(
      power > 0.85 ? "Let it rip!" : "Drag further for power · flick sideways for spin"
    );
  }

  _onRelease(shot) {
    if (this.state !== State.AIMING) return;
    if (!shot) {
      this.ui.resetPower();
      this.ui.setHint("Drag the ball back & release to bowl.");
      return;
    }
    this.input.disable();
    this.scene.hideAim();
    this.ui.resetPower();

    const aimX = shot.aim * (LANE.width / 2 - BALL_RADIUS - 0.02);
    const angle = shot.aim * 0.05; // slight initial heading from aim
    this.pinsBeforeRoll = this.physics.countDownPins();

    this.physics.launch({
      power: shot.power,
      aimX,
      angle,
      spin: shot.spin * 0.85,
    });
    this.state = State.ROLLING;
    this.ui.setHint("");
  }

  _positionBallForAim(x) {
    if (this.physics.rolling) return;
    this.physics.ball.pos.x = x;
    this.physics.ball.pos.y = BALL_RADIUS;
    this.physics.ball.pos.z = LANE.approachZ - 0.4;
    this.physics.ball.rollRot.x = 0;
    this.scene.syncBall(this.physics.ball);
  }

  // ---------- Main loop ----------
  _loop(now) {
    const dtRaw = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;

    if (this.state === State.ROLLING) {
      this.acc += dtRaw;
      while (this.acc >= this.fixedDt) {
        this.physics.step(this.fixedDt);
        this.acc -= this.fixedDt;
      }
      this.scene.syncBall(this.physics.ball);
      this.scene.syncPins(this.physics.pins);

      // Camera follows the ball, then swings to the pins near the deck.
      const bz = this.physics.ball.pos.z;
      if (bz > LANE.pinDeckZ - 6) {
        this.scene.setCameraPins();
      } else {
        this.scene.setCameraFollow(bz, this.physics.ball.pos.x);
      }

      if (this.physics.isSettled()) {
        this.physics.endRoll();
        this.state = State.SETTLING;
        this.settleHold = 0;
      }
    } else if (this.state === State.SETTLING) {
      this.settleHold += dtRaw;
      // brief pause to admire the result before scoring
      if (this.settleHold > 0.4) {
        this._scoreRoll();
      }
    } else if (this.state === State.RESETTING) {
      this.resetTimer -= dtRaw;
      if (this.resetTimer <= 0) {
        this._beginNextBall();
      }
    }

    this.scene.render(dtRaw);
    requestAnimationFrame(this._loop);
  }

  // ---------- Scoring a completed roll ----------
  _scoreRoll() {
    const downNow = this.physics.countDownPins();
    const knockedThisRoll = Math.max(0, downNow - this.pinsBeforeRoll);

    const result = this.game.roll(knockedThisRoll);
    this._refreshScoreboard();

    // Celebratory banners.
    if (result.isStrike) {
      this.scene.setCameraPins();
      this.ui.showBanner("STRIKE!", "strike");
    } else if (result.isSpare) {
      this.ui.showBanner("SPARE!", "spare");
    } else if (knockedThisRoll === 0 && this.physics.ballInGutter) {
      this.ui.showBanner("GUTTER", "");
    } else if (knockedThisRoll === 0) {
      this.ui.showBanner("MISS", "");
    } else if (this.game.isFirstBallOfFrame() === false && !result.frameComplete) {
      // mid-frame: small numeric feedback only via scoreboard
    }

    if (result.gameComplete) {
      this.state = State.RESETTING;
      this.resetTimer = 2.0;
      this._gameWillEnd = true;
      return;
    }

    // Decide pin reset behaviour for the next ball.
    this._nextResetPins = result.resetPins;
    this.state = State.RESETTING;
    this.resetTimer = result.resetPins ? 1.8 : 1.4;
  }

  _beginNextBall() {
    if (this._gameWillEnd) {
      this._gameWillEnd = false;
      this._endGame();
      return;
    }

    if (this._nextResetPins) {
      this.physics.rackFull();
    } else {
      // Sweep away the deadwood, keep standing pins.
      this.physics.clearKnockedPins();
    }
    this._nextResetPins = false;

    this.currentAim = 0;
    this.currentSpin = 0;
    this.physics.resetBall(0);
    this._positionBallForAim(0);
    this.scene.syncPins(this.physics.pins);
    this.scene.setCameraBowler();
    this.scene.showAim(0, 0, 0);
    this.ui.updateAim(0, 0);
    this.ui.setHint(
      this.game.isFirstBallOfFrame()
        ? "New frame — knock 'em all down!"
        : "Pick up the spare!"
    );
    this.state = State.AIMING;
    this.input.enable();
    this._refreshScoreboard();
  }

  _endGame() {
    this.state = State.GAMEOVER;
    this.input.disable();
    const total = this.game.getTotal();
    this.scene.setCameraPins();
    this.ui.showGameOver(total);
  }

  _refreshScoreboard() {
    const card = this.game.getScorecard();
    const total = this.game.getTotal();
    const active = Math.min(this.game.currentFrame, 9);
    this.ui.renderScorecard(card, active, total);
  }
}

// Boot.
const app = new BowlingApp();
app.init();

// Expose for debugging in the console.
window.__bowling = app;
