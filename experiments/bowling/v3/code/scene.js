// scene.js — Three.js scene construction and visual sync.
// Builds the bowling alley (lane, gutters, pin deck, ball, pins, lighting)
// and exposes helpers to sync mesh transforms from the physics state.

import * as THREE from "three";
import { LANE, BALL_RADIUS, PIN_HEIGHT } from "./physics.js";

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  // Behind the foul line, slightly elevated, looking down the lane.
  cam.position.set(0, 1.5, -2.6);
  cam.lookAt(0, 0.4, 8);
  return cam;
}

// Procedural wood texture for the lane (canvas-based, no asset loading).
function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 1024;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, "#c8923f");
  grad.addColorStop(0.5, "#e0ab57");
  grad.addColorStop(1, "#c8923f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  // Plank seams running lengthwise.
  ctx.strokeStyle = "rgba(90,55,20,0.35)";
  ctx.lineWidth = 1;
  const planks = 8;
  for (let i = 1; i < planks; i++) {
    const x = (c.width / planks) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.stroke();
  }
  // Subtle grain noise.
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "#7a4d18" : "#fff2cf";
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 2);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildAlley(scene) {
  // Ambient + directional lighting for soft shadows.
  scene.add(new THREE.AmbientLight(0x5566aa, 0.6));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.15);
  key.position.set(-3, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.PointLight(0x88aaff, 0.5, 30);
  fill.position.set(0, 5, 16);
  scene.add(fill);

  // Background / room.
  scene.background = new THREE.Color(0x0a0d1a);
  scene.fog = new THREE.Fog(0x0a0d1a, 18, 34);

  // --- Lane surface ---
  const laneLen = LANE.length + 2;
  const laneGeo = new THREE.BoxGeometry(LANE.width, 0.1, laneLen);
  const tex = woodTexture();
  tex.repeat.set(1, 14);
  const laneMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.25,
    metalness: 0.0,
  });
  const lane = new THREE.Mesh(laneGeo, laneMat);
  lane.position.set(0, -0.05, laneLen / 2 - 1);
  lane.receiveShadow = true;
  scene.add(lane);

  // Glossy clear-coat sheen overlay (a faint reflective plane).
  const sheenMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.06,
    roughness: 0.05,
    metalness: 0.6,
  });
  const sheen = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE.width, laneLen),
    sheenMat,
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.set(0, 0.001, laneLen / 2 - 1);
  scene.add(sheen);

  // --- Gutters ---
  const gutterMat = new THREE.MeshStandardMaterial({
    color: 0x1b2233,
    roughness: 0.4,
    metalness: 0.3,
  });
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.12, laneLen),
      gutterMat,
    );
    g.position.set(side * (LANE.halfWidth + 0.07), -0.11, laneLen / 2 - 1);
    g.receiveShadow = true;
    scene.add(g);
  }

  // Lane side rails / walls.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x141a2e,
    roughness: 0.6,
  });
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, laneLen), wallMat);
    w.position.set(side * (LANE.halfWidth + 0.22), 0.6, laneLen / 2 - 1);
    scene.add(w);
  }

  // --- Aiming guide arrows on the lane (like real lane dots/arrows) ---
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x3a2a10 });
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const tri = new THREE.Mesh(new THREE.CircleGeometry(0.025, 8), arrowMat);
    tri.rotation.x = -Math.PI / 2;
    tri.position.set(i * 0.13, 0.002, 4.5 + Math.abs(i) * 0.35);
    scene.add(tri);
  }
  // Foul-line dots.
  for (let i = -4; i <= 4; i++) {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), arrowMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(i * 0.1, 0.002, 1.2);
    scene.add(dot);
  }

  // --- Pin deck backdrop / pit ---
  const backMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.8,
  });
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(LANE.width + 0.5, 2.4, 0.2),
    backMat,
  );
  back.position.set(0, 1.0, LANE.pinDeckZ + 1.6);
  scene.add(back);

  // Decorative neon strip behind pins.
  const neon = new THREE.Mesh(
    new THREE.BoxGeometry(LANE.width + 0.4, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x35e0ff }),
  );
  neon.position.set(0, 2.0, LANE.pinDeckZ + 1.5);
  scene.add(neon);

  return { lane };
}

// Build a single bowling pin mesh (lathe profile -> classic pin silhouette).
function makePinMesh(color) {
  const points = [];
  // Profile from base (y=0) to top, radii roughly to scale.
  const profile = [
    [0.0, 0.0],
    [0.045, 0.0],
    [0.06, 0.05],
    [0.058, 0.12],
    [0.035, 0.2],
    [0.028, 0.26],
    [0.04, 0.32],
    [0.03, 0.37],
    [0.0, 0.38],
  ];
  for (const [r, y] of profile) points.push(new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(points, 20);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.35,
    metalness: 0.05,
  });
  const pin = new THREE.Mesh(geo, mat);
  pin.castShadow = true;
  pin.receiveShadow = true;

  // Red neck stripes.
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xd11f2d,
    roughness: 0.4,
  });
  const s1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.031, 0.031, 0.02, 16, 1, true),
    stripeMat,
  );
  s1.position.y = 0.29;
  pin.add(s1);
  const s2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.033, 0.033, 0.02, 16, 1, true),
    stripeMat,
  );
  s2.position.y = 0.24;
  pin.add(s2);

  // Group so we can tilt the whole pin about its base.
  const group = new THREE.Group();
  group.add(pin);
  return group;
}

export function buildPins(scene, pinStates) {
  const meshes = [];
  for (const p of pinStates) {
    const m = makePinMesh();
    m.position.set(p.x, 0, p.z);
    scene.add(m);
    meshes.push(m);
  }
  return meshes;
}

export function buildBall(scene, color = 0x1565ff) {
  const geo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.12,
    metalness: 0.35,
    emissive: new THREE.Color(color).multiplyScalar(0.05),
  });
  const ball = new THREE.Mesh(geo, mat);
  ball.castShadow = true;

  // Finger holes (three small dark dimples).
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x05070d });
  for (const [a, b] of [
    [0.2, 0.1],
    [-0.1, 0.25],
    [0.1, 0.3],
  ]) {
    const hole = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 0.22, 12, 12),
      holeMat,
    );
    hole.position.set(
      Math.sin(a) * BALL_RADIUS,
      BALL_RADIUS * 0.8,
      Math.cos(b) * BALL_RADIUS * 0.6,
    );
    ball.add(hole);
  }
  scene.add(ball);
  return ball;
}

// Sync a ball mesh to its physics state; roll it visually.
export function syncBall(mesh, ball, dt) {
  mesh.position.set(ball.x, ball.y + BALL_RADIUS, ball.z);
  // Rolling rotation proportional to travel.
  const speed = Math.hypot(ball.vx, ball.vz);
  if (speed > 0.01) {
    const axisX = -ball.vz;
    const axisZ = ball.vx;
    const len = Math.hypot(axisX, axisZ) || 1;
    mesh.rotateOnWorldAxis(
      new THREE.Vector3(axisX / len, 0, axisZ / len),
      (speed * dt) / BALL_RADIUS,
    );
  }
}

// Sync pin meshes to physics states (position + topple tilt).
export function syncPins(meshes, pinStates) {
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const p = pinStates[i];
    m.position.set(p.x, 0, p.z);
    if (p.fallen && p.tilt > 0) {
      // Rotate the group about its base toward the fall direction.
      const axis = new THREE.Vector3(p.tiltAxisZ, 0, -p.tiltAxisX).normalize();
      m.quaternion.setFromAxisAngle(axis, p.tilt);
      // When fully fallen, drop it to lie on the deck.
      m.position.y = 0;
    } else {
      m.quaternion.identity();
    }
    m.visible = true;
  }
}
