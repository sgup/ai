// main.js — Game orchestration: scene, state machine, scoring, HUD.
import * as THREE from "three";
import {
  createGame,
  roll,
  totalScore,
  pinsStandingForCurrentBall,
  TOTAL_FRAMES,
} from "./scoring.js";
import {
  createPins,
  createBall,
  step,
  countFallen,
  isSettled,
  LANE,
  BALL_RADIUS,
} from "./physics.js";
import {
  createRenderer,
  createCamera,
  buildAlley,
  buildPins,
  buildBall,
  syncBall,
  syncPins,
} from "./scene.js";
import { InputController } from "./input.js";

const BALL_COLORS = [0x1565ff, 0xd11f5a, 0x18b562, 0xff8c1a, 0x9b51e0];

// ---- DOM ----
const canvas = document.getElementById("scene");
const loadingEl = document.getElementById("loading");
const scoreboardEl = document.getElementById("scoreboard");
const controlsEl = document.getElementById("controls");
const powerFill = document.getElementById("power-fill");
const spinSlider = document.getElementById("spin-slider");
const spinValue = document.getElementById("spin-value");
const statusEl = document.getElementById("status");
const messageEl = document.getElementById("message");
const newGameBtn = document.getElementById("new-game");

// ---- Three.js ----
const renderer = createRenderer(canvas);
const camera = createCamera();
const scene = new THREE.Scene();
buildAlley(scene);

// ---- Game state machine ----
const PHASE = {
  AIM: "aim",
  ROLLING: "rolling",
  SETTLING: "settling",
  BETWEEN: "between",
  GAMEOVER: "gameover",
};

let game,
  sim,
  ballMesh,
  pinMeshes,
  phase,
  ballColorIndex = 0;
let guideLine, aimX, spin;
let pinsBeforeRoll = 0; // pins standing at the start of the current ball
let settleTimer = 0;
let cameraTarget = new THREE.Vector3(0, 0.4, 8);

function freshPinMeshes(states) {
  if (pinMeshes) for (const m of pinMeshes) scene.remove(m);
  pinMeshes = buildPins(scene, states);
}

function freshBallMesh() {
  if (ballMesh) scene.remove(ballMesh);
  ballMesh = buildBall(scene, BALL_COLORS[ballColorIndex % BALL_COLORS.length]);
}

// Build the dashed aiming guide line (updated each aim frame).
function buildGuide() {
  if (guideLine) scene.remove(guideLine);
  const mat = new THREE.LineDashedMaterial({
    color: 0x35e0ff,
    dashSize: 0.18,
    gapSize: 0.12,
    transparent: true,
    opacity: 0.8,
  });
  const geo = new THREE.BufferGeometry();
  guideLine = new THREE.Line(geo, mat);
  scene.add(guideLine);
}

// Predict the rough path of the ball for the guide line, mirroring the hook.
function updateGuide() {
  if (!guideLine) return;
  const pts = [];
  let x = aimX;
  let z = 0;
  let vx = 0;
  const vz = 7.5;
  const steps = 60;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    // Approximate hook: lateral drift increases down the lane.
    vx += spin * 0.9 * 0.016 * (0.4 + t);
    x += vx * 0.05;
    z += vz * 0.05;
    if (z > LANE.pinDeckZ + 0.5) break;
    if (Math.abs(x) > LANE.halfWidth) break;
    pts.push(new THREE.Vector3(x, 0.02, z));
  }
  guideLine.geometry.setFromPoints(pts);
  guideLine.computeLineDistances();
  guideLine.visible = phase === PHASE.AIM;
}

// Position the ball at the foul line ready to throw.
function placeBallAtFoul() {
  ballMesh.position.set(aimX, BALL_RADIUS, 0.1);
  ballMesh.quaternion.identity();
  ballMesh.visible = true;
}

function startGame() {
  game = createGame();
  ballColorIndex = 0;
  setupRack(true);
  phase = PHASE.AIM;
  aimX = 0;
  spin = 0;
  buildGuide();
  hide(messageEl);
  renderScoreboard();
  setStatus("Frame 1 — aim with the mouse, hold to charge, release to bowl.");
}

// (Re)build the pin rack. fullReset = brand new rack of 10.
function setupRack(fullReset) {
  let states = createPins();
  if (!fullReset) {
    // Keep only the pins still standing from the previous ball in this frame.
    states = createPins().filter((p) => standingIds.has(p.id));
  }
  sim = { ball: null, pins: states };
  freshPinMeshes(states);
  syncPins(pinMeshes, states);
}

let standingIds = new Set();

function beginRoll(throwData) {
  if (phase !== PHASE.AIM) return;
  aimX = throwData.aimX;
  spin = throwData.spin;

  pinsBeforeRoll = pinsStandingForCurrentBall(game);

  // Map power (0..1) -> ball speed (m/s). Min must still reach the pins.
  const speed = 5.0 + throwData.power * 5.5; // 5.0 .. 10.5 m/s
  // A small aim angle proportional to how far off-center you started, so
  // edge starts angle gently back toward the pocket (subtle, optional).
  const dirX = 0;
  const dirZ = 1;
  sim.ball = createBall({
    x: aimX,
    speed,
    dirX,
    dirZ,
    spin: spin * 0.22, // scale slider (-1..1) into physics spin range
  });

  phase = PHASE.ROLLING;
  guideLine.visible = false;
  setStatus("");
  hide(controlsEl);
}

function finishRoll() {
  const fallenNow = countFallen(sim.pins);
  // Pins knocked on THIS ball. The rack was rebuilt to hold only the pins
  // that were standing at the start of this ball, so every fallen pin here
  // was knocked by this throw. Clamp defensively to the count we expected.
  const knocked = Math.max(0, Math.min(pinsBeforeRoll, fallenNow));

  // Record which physical pins remain standing (for partial rack rebuild).
  standingIds = new Set(
    sim.pins.filter((p) => !p.fallen && p.tilt < 0.7).map((p) => p.id),
  );

  const prevFrame = game.currentFrame;
  const result = roll(game, knocked);
  renderScoreboard();

  // Decide messaging.
  if (result.wasStrike) flash("STRIKE!", "#ffd54a");
  else if (result.wasSpare) flash("SPARE!", "#7fe0ff");
  else if (knocked === 0 && !sim.ball.inGutter) flash("Missed!", "#ff8a8a");
  else if (sim.ball.inGutter) flash("Gutter ball", "#ff8a8a");

  if (game.complete) {
    endGame();
    return;
  }

  // Set up the next ball.
  phase = PHASE.BETWEEN;
  settleTimer = 0;
  prepareNextBall(result, prevFrame);
}

function prepareNextBall(result, prevFrame) {
  const frameChanged = game.currentFrame !== prevFrame;
  // On a new frame, fresh rack + maybe a new ball color.
  if (frameChanged) {
    ballColorIndex++;
    setupRack(true);
  } else if (result.rackReset) {
    // 10th-frame strike/spare: fresh rack mid-frame.
    setupRack(true);
  } else {
    // Same frame, second ball: only the standing pins remain.
    setupRack(false);
  }
  freshBallMesh();
}

function endGame() {
  phase = PHASE.GAMEOVER;
  const total = totalScore(game);
  let title = "Game Over";
  let sub = `Final score: ${total}`;
  if (total === 300) {
    title = "PERFECT GAME!";
    sub = "300 — twelve strikes in a row.";
  } else if (total >= 200) {
    title = "Outstanding!";
  } else if (total >= 150) {
    title = "Great game!";
  }
  show(messageEl);
  messageEl.querySelector(".msg-title").textContent = title;
  messageEl.querySelector(".msg-sub").textContent = sub;
  hide(controlsEl);
}

// ---- HUD ----
function renderScoreboard() {
  const wrap = document.getElementById("sb-frames");
  wrap.innerHTML = "";
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const f = game.frames[i];
    const cell = document.createElement("div");
    cell.className = "sb-frame";
    if (i === game.currentFrame && !game.complete) cell.classList.add("active");

    const num = document.createElement("div");
    num.className = "sb-frame-num";
    num.textContent = i + 1;

    const rolls = document.createElement("div");
    rolls.className = "sb-rolls";
    rolls.innerHTML = renderRolls(f, i === TOTAL_FRAMES - 1);

    const cum = document.createElement("div");
    cum.className = "sb-cum";
    cum.textContent = f.cumulative !== null ? f.cumulative : "";

    cell.appendChild(num);
    cell.appendChild(rolls);
    cell.appendChild(cum);
    wrap.appendChild(cell);
  }
  document.getElementById("sb-total-value").textContent = totalScore(game);
}

function symbol(prev, val, isStrikeBall) {
  if (val === undefined || val === null) return "";
  if (isStrikeBall && val === 10) return "X";
  if (prev !== undefined && prev + val === 10 && prev !== 10) return "/";
  if (val === 0) return "-";
  return String(val);
}

function renderRolls(f, isTenth) {
  const r = f.rolls;
  const cells = [];
  if (!isTenth) {
    if (r[0] === 10) {
      cells.push("", "X");
    } else {
      cells.push(symbol(undefined, r[0], true));
      cells.push(symbol(r[0], r[1], false));
    }
  } else {
    // up to three balls; each strike shows X, spare second shows /
    let prevForSpare = undefined;
    for (let k = 0; k < 3; k++) {
      const v = r[k];
      if (v === undefined) {
        cells.push("");
        continue;
      }
      if (v === 10) {
        cells.push("X");
        prevForSpare = undefined; // strike resets spare context
      } else if (prevForSpare !== undefined && prevForSpare + v === 10) {
        cells.push("/");
        prevForSpare = undefined;
      } else {
        cells.push(v === 0 ? "-" : String(v));
        prevForSpare = v;
      }
    }
  }
  return cells
    .map((c) => `<span class="sb-roll">${c}</span>`)
    .join("");
}

function setStatus(t) {
  statusEl.textContent = t;
}

let flashTimeout;
function flash(text, color) {
  const el = document.getElementById("flash");
  el.textContent = text;
  el.style.color = color;
  el.classList.add("show");
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => el.classList.remove("show"), 1400);
}

function show(el) {
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}

// ---- Input wiring ----
const input = new InputController(canvas, {
  getEnabled: () => phase === PHASE.AIM,
  onThrow: (t) => beginRoll(t),
  onAimChange: (ax, sp, power) => {
    if (phase === PHASE.AIM) {
      aimX = ax;
      spin = sp;
      placeBallAtFoul();
      updateGuide();
    }
    powerFill.style.width = `${(power * 100).toFixed(0)}%`;
  },
});

spinSlider.addEventListener("input", () => {
  const v = parseFloat(spinSlider.value);
  input.setSpin(v);
  spin = v;
  spinValue.textContent =
    v === 0 ? "STRAIGHT" : v < 0 ? `HOOK L ${Math.abs(v).toFixed(1)}` : `HOOK R ${v.toFixed(1)}`;
  updateGuide();
});

newGameBtn.addEventListener("click", () => {
  show(controlsEl);
  startGame();
});

// ---- Main loop ----
let last = performance.now();
function animate(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (phase === PHASE.ROLLING && sim.ball) {
    // Sub-step the physics for stability at speed.
    const subs = 3;
    for (let i = 0; i < subs; i++) step(sim, dt / subs);
    syncBall(ballMesh, sim.ball, dt);
    syncPins(pinMeshes, sim.pins);

    // Camera follows the ball down the lane.
    const followZ = Math.min(sim.ball.z, LANE.pinDeckZ - 4);
    cameraTarget.set(sim.ball.x * 0.4, 0.6, sim.ball.z + 5);
    camera.position.x += (sim.ball.x * 0.3 - camera.position.x) * 0.05;
    camera.position.z += (followZ - 3 - camera.position.z) * 0.04;
    camera.lookAt(0, 0.5, Math.max(8, sim.ball.z + 4));

    if (!sim.ball.rolling && isSettled(sim)) {
      phase = PHASE.SETTLING;
      settleTimer = 0;
    }
  } else if (phase === PHASE.SETTLING) {
    // Let pins settle visually for a beat, then score.
    syncPins(pinMeshes, sim.pins);
    settleTimer += dt;
    step(sim, dt); // continue resolving any residual motion
    if (settleTimer > 0.7) {
      finishRoll();
    }
  } else if (phase === PHASE.BETWEEN) {
    settleTimer += dt;
    // Ease camera back to the bowling position.
    camera.position.x += (0 - camera.position.x) * 0.08;
    camera.position.z += (-2.6 - camera.position.z) * 0.08;
    camera.lookAt(0, 0.4, 8);
    if (settleTimer > 0.6) {
      phase = PHASE.AIM;
      placeBallAtFoul();
      buildGuide();
      updateGuide();
      show(controlsEl);
      const fn = game.currentFrame + 1;
      setStatus(`Frame ${fn} — aim and bowl.`);
    }
  } else if (phase === PHASE.AIM) {
    // idle: ensure camera at rest
    camera.position.x += (0 - camera.position.x) * 0.06;
    camera.position.z += (-2.6 - camera.position.z) * 0.06;
    camera.lookAt(0, 0.4, 8);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---- Resize ----
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", onResize);

// ---- Boot ----
function boot() {
  onResize();
  freshBallMesh();
  startGame();
  placeBallAtFoul();
  buildGuide();
  updateGuide();
  hide(loadingEl);
  show(scoreboardEl);
  show(controlsEl);
  requestAnimationFrame(animate);
}

// Give the import map a tick, then boot.
boot();
