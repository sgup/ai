// Game orchestration: ties physics + scene + scoring + input + HUD together,
// and runs the frame/ball state machine.
//
// States:
//   AIMING   - player aims & charges power with the mouse
//   ROLLING  - ball is in motion, camera follows
//   SETTLING - waiting for pins/ball to stop
//   SCORING  - count pins, update scoreboard, brief pause
//   RESET    - rack/sweep for next ball or frame
//   GAMEOVER - final score shown

import * as THREE from "three";
import { PhysicsWorld, LANE_WIDTH, PIN_SPOT_Z } from "./physics.js";
import { BowlingScene } from "./scene.js";
import {
  createGame,
  roll,
  pinsAvailable,
  frameScores,
  totalScore,
  rollSymbol,
  TOTAL_FRAMES,
} from "./scoring.js";
import { InputController } from "./input.js";

const STATE = {
  AIMING: "AIMING",
  ROLLING: "ROLLING",
  SETTLING: "SETTLING",
  SCORING: "SCORING",
  RESET: "RESET",
  GAMEOVER: "GAMEOVER",
};

const BALL_COLORS = [0x1f6fff, 0xff3b3b, 0x29c46a, 0xb14bff, 0xff8c1a, 0x14d3d3];

export class BowlingGame {
  constructor(canvas, hud) {
    this.physics = new PhysicsWorld();
    this.scene = new BowlingScene(canvas);
    this.scene.buildPins(this.physics.pins);
    this.hud = hud;

    this.scoreGame = createGame();
    this.state = STATE.AIMING;
    this.standingBefore = this.physics.standingMask(); // all true at frame start
    this.settleTimer = 0;
    this.scoreTimer = 0;
    this.clock = new THREE.Clock();
    this.colorIndex = 0;

    this.input = new InputController(canvas, {
      onAimUpdate: (aim) => this._onAimUpdate(aim),
      onRelease: (shot) => this._throw(shot),
      isInteractive: () => this.state === STATE.AIMING,
    });

    window.addEventListener("resize", () => this.scene.resize());

    this._renderScoreboard();
    this._setMessage("Drag back and release to bowl. Aim with left/right.");
    this._loop();
  }

  _onAimUpdate(aim) {
    // aim: { aimX (-1..1), angle (rad), power (0..1), spin (-1..1) }
    const x = aim.aimX * (LANE_WIDTH / 2 - 0.08);
    this.physics.resetBall(x);
    this.scene.syncBall(this.physics.ball);
    this.scene.showAim(x, aim.angle, aim.power);
    this.hud.setPower(aim.power, aim.spin);
  }

  _throw(shot) {
    if (this.state !== STATE.AIMING) return;
    const x = shot.aimX * (LANE_WIDTH / 2 - 0.08);
    const speed = 7 + shot.power * 9; // 7..16 m/s
    const dirX = Math.tan(shot.angle) * speed * 0.6;
    const spin = shot.spin * 14; // hook strength
    this.physics.launchBall({ speed, aimX: x, dirX, spin });
    this.scene.hideAim();
    this.state = STATE.ROLLING;
    this.settleTimer = 0;
    this._setMessage("");
    this.hud.setPower(0, 0);
  }

  _frameNumber() {
    return this.scoreGame.currentFrame + 1;
  }

  _ballNumberInFrame() {
    return this.scoreGame.frames[this.scoreGame.currentFrame].rolls.length + 1;
  }

  _afterSettle() {
    // Count how many of the pins that were standing are now down.
    const standingNow = this.physics.standingMask();
    let knocked = 0;
    for (let i = 0; i < standingNow.length; i++) {
      if (this.standingBefore[i] && !standingNow[i]) knocked++;
    }
    // Clamp to pins available (defensive against physics jitter miscounts).
    const avail = pinsAvailable(this.scoreGame);
    knocked = Math.max(0, Math.min(knocked, avail));

    const before = this.scoreGame.currentFrame;
    const result = roll(this.scoreGame, knocked);
    this._renderScoreboard();

    // Decide what message / animation to show.
    let msg = `${knocked} pin${knocked === 1 ? "" : "s"}`;
    const frameRolls = this.scoreGame.frames[before].rolls;
    if (knocked === 10 && frameRolls.length === 1) msg = "STRIKE!  🎳";
    else if (
      frameRolls.length >= 2 &&
      frameRolls[frameRolls.length - 2] + frameRolls[frameRolls.length - 1] === 10 &&
      frameRolls[frameRolls.length - 2] !== 10
    )
      msg = "SPARE!  ✨";
    else if (knocked === 0) msg = "Gutter / Miss";

    this._setMessage(msg);
    this.scoreTimer = 0;
    this.state = STATE.SCORING;
    this._pendingResult = result;
  }

  _applyResult(result) {
    if (result.type === "gameOver") {
      this.state = STATE.GAMEOVER;
      this.hud.showGameOver(totalScore(this.scoreGame), () => this.restart());
      return;
    }

    if (result.type === "nextBall") {
      // Same frame: sweep fallen pins, leave standing ones, fresh ball.
      const standingNow = this.physics.standingMask();
      // For the 10th frame, a strike/spare on a ball gives a fresh rack.
      const avail = pinsAvailable(this.scoreGame);
      if (avail === 10) {
        this.physics.resetPins(); // fresh rack
      } else {
        this.physics.resetPins(standingNow); // keep standers, remove fallen
      }
      this.standingBefore = this.physics.standingMask();
    } else if (result.type === "nextFrame") {
      this.physics.resetPins(); // fresh full rack
      this.standingBefore = this.physics.standingMask();
      // New ball color each frame for variety.
      this.colorIndex = (this.colorIndex + 1) % BALL_COLORS.length;
      this.scene.setBallColor(BALL_COLORS[this.colorIndex]);
    }

    this.physics.resetBall(0);
    this.scene.syncBall(this.physics.ball);
    this.scene.syncPins(this.physics.pins);
    this.state = STATE.AIMING;
    this.input.reset();
    this._updateTurnLabel();
    this._setMessage("");
  }

  restart() {
    this.scoreGame = createGame();
    this.physics.resetPins();
    this.physics.resetBall(0);
    this.standingBefore = this.physics.standingMask();
    this.colorIndex = 0;
    this.scene.setBallColor(BALL_COLORS[0]);
    this.scene.syncPins(this.physics.pins);
    this.scene.syncBall(this.physics.ball);
    this.state = STATE.AIMING;
    this.input.reset();
    this.hud.hideGameOver();
    this._renderScoreboard();
    this._updateTurnLabel();
    this._setMessage("New game! Drag back and release to bowl.");
  }

  _updateTurnLabel() {
    this.hud.setTurn(this._frameNumber(), this._ballNumberInFrame());
  }

  _setMessage(text) {
    this.hud.setMessage(text);
  }

  _renderScoreboard() {
    const scores = frameScores(this.scoreGame);
    const cells = [];
    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const rolls = this.scoreGame.frames[f].rolls;
      const isTenth = f === TOTAL_FRAMES - 1;
      const symbols = [];
      const slots = isTenth ? 3 : 2;
      for (let r = 0; r < slots; r++) {
        symbols.push(rollSymbol(this.scoreGame, f, r));
      }
      cells.push({
        frame: f + 1,
        symbols,
        score: scores[f],
        active: f === this.scoreGame.currentFrame && !this.scoreGame.over,
      });
    }
    this.hud.renderScoreboard(cells, totalScore(this.scoreGame));
    this._updateTurnLabel();
  }

  _cameraMode() {
    if (this.state === STATE.ROLLING) {
      if (this.physics.ball.position.z > PIN_SPOT_Z - 5) return "pins";
      return "follow";
    }
    if (this.state === STATE.SETTLING || this.state === STATE.SCORING)
      return "pins";
    return "aim";
  }

  _loop = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === STATE.ROLLING || this.state === STATE.SETTLING) {
      this.physics.step(dt);
      this.scene.syncBall(this.physics.ball);
      this.scene.syncPins(this.physics.pins);

      if (this.state === STATE.ROLLING) {
        // Transition to settling once the ball reaches the pins or leaves play.
        if (
          this.physics.ball.position.z > PIN_SPOT_Z - 1.5 ||
          this.physics.ball.position.z > 4 &&
            Math.abs(this.physics.ball.position.x) > LANE_WIDTH / 2 + 0.05
        ) {
          this.state = STATE.SETTLING;
          this.settleTimer = 0;
        }
      } else if (this.state === STATE.SETTLING) {
        this.settleTimer += dt;
        if (this.physics.isSettled() || this.settleTimer > 6) {
          this._afterSettle();
        }
      }
    } else if (this.state === STATE.SCORING) {
      // keep stepping a touch so pins finish toppling visually
      this.physics.step(dt);
      this.scene.syncPins(this.physics.pins);
      this.scoreTimer += dt;
      if (this.scoreTimer > 1.6) {
        this._applyResult(this._pendingResult);
      }
    }

    this.scene.updateCamera(this.physics.ball, this._cameraMode());
    this.scene.render();
    requestAnimationFrame(this._loop);
  };
}
