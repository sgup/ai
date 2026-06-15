/**
 * scene.js — Three.js rendering layer for the bowling alley.
 *
 * Owns the scene graph (lane, gutters, pins, ball, environment, lighting) and
 * exposes update hooks the game loop calls with positions/rotations coming out
 * of the physics simulator. Knows nothing about scoring or input.
 */

import * as THREE from "three";
import {
  LANE,
  BALL_RADIUS,
  PIN_RADIUS,
  PIN_HEIGHT,
} from "./physics.js";

export const BALL_COLORS = [
  { name: "Fireball", hex: 0xe23636, accent: 0xff8a5c },
  { name: "Ocean", hex: 0x1f6fe0, accent: 0x6fd6ff },
  { name: "Venom", hex: 0x37c871, accent: 0xc6ff8a },
  { name: "Royal", hex: 0x8a4fff, accent: 0xd6b0ff },
  { name: "Onyx", hex: 0x1a1a22, accent: 0x4a4a66 },
  { name: "Sunset", hex: 0xff8c1a, accent: 0xffd56b },
];

export class BowlingScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060d);
    this.scene.fog = new THREE.Fog(0x05060d, 22, 40);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this._setBowlerCamera();

    this._buildLights();
    this._buildEnvironment();
    this._buildLane();
    this.pinMeshes = this._buildPins();
    this.ballMesh = this._buildBall(BALL_COLORS[0]);
    this.arrow = this._buildAimArrow();

    this._tmpQ = new THREE.Quaternion();
    this._tmpE = new THREE.Euler();

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  // ---------- Camera presets ----------
  _setBowlerCamera() {
    this.camera.position.set(0, 1.6, -2.6);
    this.camera.lookAt(0, 0.6, LANE.pinDeckZ * 0.5);
    this.camFrom = this.camera.position.clone();
  }

  setCameraBowler() {
    this._lerpCamera(new THREE.Vector3(0, 1.6, -2.6), new THREE.Vector3(0, 0.6, LANE.pinDeckZ * 0.5));
  }
  setCameraFollow(ballZ, ballX) {
    const z = Math.min(ballZ - 3.2, LANE.pinDeckZ - 4.5);
    this._lerpCamera(
      new THREE.Vector3(ballX * 0.3, 1.3, z),
      new THREE.Vector3(ballX * 0.5, 0.4, ballZ + 2.5)
    );
  }
  setCameraPins() {
    this._lerpCamera(
      new THREE.Vector3(0, 1.9, LANE.pinDeckZ - 4.3),
      new THREE.Vector3(0, 0.5, LANE.pinDeckZ + 0.5)
    );
  }
  _lerpCamera(pos, look) {
    this._camTarget = { pos, look };
  }
  _updateCamera(dt) {
    if (!this._camTarget) return;
    const k = 1 - Math.pow(0.001, dt);
    this.camera.position.lerp(this._camTarget.pos, k);
    if (!this._lookAt) this._lookAt = new THREE.Vector3(0, 0.6, 8);
    this._lookAt.lerp(this._camTarget.look, k);
    this.camera.lookAt(this._lookAt);
  }

  // ---------- Lights ----------
  _buildLights() {
    const ambient = new THREE.AmbientLight(0x6678aa, 0.55);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x9fc0ff, 0x141018, 0.6);
    this.scene.add(hemi);

    // Key light over the lane, casts ball/pin shadows.
    const key = new THREE.DirectionalLight(0xfff1d8, 1.15);
    key.position.set(3, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    const s = 12;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -22;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    this.scene.add(key.target);
    key.target.position.set(0, 0, 9);

    // Pin-deck spotlight for drama.
    const spot = new THREE.SpotLight(0xffffff, 2.2, 14, Math.PI / 6, 0.4, 1.0);
    spot.position.set(0, 6, LANE.pinDeckZ - 2);
    spot.target.position.set(0, 0, LANE.pinDeckZ + 0.5);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot);
    this.scene.add(spot.target);

    // Cool fill from behind the bowler.
    const fill = new THREE.PointLight(0x4f7bff, 0.7, 18);
    fill.position.set(0, 3, -4);
    this.scene.add(fill);
  }

  // ---------- Environment ----------
  _buildEnvironment() {
    // Floor of the bowling alley.
    const floorGeo = new THREE.PlaneGeometry(30, 50);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c1224,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.02, LANE.length / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Back wall behind the pins with neon strips.
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x10142a,
      roughness: 0.7,
      metalness: 0.2,
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), wallMat);
    wall.position.set(0, 5, LANE.pinDeckZ + 3.2);
    wall.rotation.y = Math.PI;
    this.scene.add(wall);

    // Neon accent strips on the back wall.
    const neonColors = [0xff4d6d, 0x4fc3ff, 0xffb347];
    neonColors.forEach((c, i) => {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(20, 0.12, 0.05),
        new THREE.MeshBasicMaterial({ color: c })
      );
      strip.position.set(0, 2.4 + i * 1.5, LANE.pinDeckZ + 3.15);
      this.scene.add(strip);
    });

    // Pin-setter masking unit above the deck.
    const masking = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.width + 1.2, 2.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x07101f, roughness: 0.6, metalness: 0.3 })
    );
    masking.position.set(0, 2.6, LANE.pinDeckZ + 1.2);
    masking.castShadow = true;
    this.scene.add(masking);

    // "STRIKE ZONE" glow bar on the masking unit.
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.width + 0.8, 0.5, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffb347 })
    );
    bar.position.set(0, 2.2, LANE.pinDeckZ + 1.05);
    this.scene.add(bar);
  }

  // ---------- Lane ----------
  _buildLane() {
    const laneLen = LANE.length;
    const laneCenterZ = laneLen / 2;

    // Wood lane surface — procedural plank texture via canvas.
    const tex = this._makeWoodTexture();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 18);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const laneMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.28,
      metalness: 0.05,
      color: 0xffffff,
    });
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.width, 0.08, laneLen + 1.5),
      laneMat
    );
    lane.position.set(0, 0, laneCenterZ - 0.2);
    lane.receiveShadow = true;
    this.scene.add(lane);

    // Oil-shine overlay near the front (subtle gloss patch).
    const oil = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE.width * 0.9, laneLen * 0.55),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.05,
        metalness: 0.0,
        transparent: true,
        opacity: 0.06,
      })
    );
    oil.rotation.x = -Math.PI / 2;
    oil.position.set(0, 0.041, laneLen * 0.3);
    this.scene.add(oil);

    // Aiming arrows (the classic 7 dovetail arrows ~15ft down lane).
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0x12233f,
      roughness: 0.4,
    });
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 4), arrowMat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(i * 0.11, 0.045, 5.2 + Math.abs(i) * 0.25);
      this.scene.add(a);
    }
    // Foul-line dots.
    for (let i = -2; i <= 2; i++) {
      const d = new THREE.Mesh(
        new THREE.CircleGeometry(0.022, 12),
        new THREE.MeshStandardMaterial({ color: 0x203a5f })
      );
      d.rotation.x = -Math.PI / 2;
      d.position.set(i * 0.13, 0.043, 0.6);
      this.scene.add(d);
    }

    // Gutters (channels) on each side.
    const gutterMat = new THREE.MeshStandardMaterial({
      color: 0x05080f,
      roughness: 0.5,
      metalness: 0.4,
    });
    const halfW = LANE.width / 2;
    for (const sign of [-1, 1]) {
      const gutter = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.14, laneLen + 1.5),
        gutterMat
      );
      gutter.position.set(sign * (halfW + 0.07), -0.05, laneCenterZ - 0.2);
      gutter.receiveShadow = true;
      this.scene.add(gutter);

      // Side rails.
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.18, laneLen + 1.5),
        new THREE.MeshStandardMaterial({ color: 0x1a2440, roughness: 0.5, metalness: 0.3 })
      );
      rail.position.set(sign * (halfW + 0.16), 0.03, laneCenterZ - 0.2);
      this.scene.add(rail);
    }

    // Pin deck (slightly different shade behind the foul of pins).
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.width, 0.082, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.35, metalness: 0.05 })
    );
    deck.position.set(0, 0.001, LANE.pinDeckZ + 0.45);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Pit / back curtain.
    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.width + 0.5, 1.0, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x02030a, roughness: 1 })
    );
    pit.position.set(0, -0.5, LANE.pinDeckZ + 2.4);
    this.scene.add(pit);
  }

  _makeWoodTexture() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 1024;
    const ctx = c.getContext("2d");
    // Base maple gradient.
    const grd = ctx.createLinearGradient(0, 0, c.width, 0);
    grd.addColorStop(0, "#caa377");
    grd.addColorStop(0.5, "#e3c193");
    grd.addColorStop(1, "#c79a6a");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, c.width, c.height);
    // Planks.
    const plankW = c.width / 8;
    for (let i = 0; i <= 8; i++) {
      ctx.strokeStyle = "rgba(80,52,28,0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(i * plankW, 0);
      ctx.lineTo(i * plankW, c.height);
      ctx.stroke();
    }
    // Grain.
    ctx.strokeStyle = "rgba(120,82,46,0.18)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 6, y + 30 + Math.random() * 60);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------- Pins ----------
  _makePinGeometry() {
    // Lathe a bowling-pin silhouette.
    const profile = [
      [0.0, 0.0],
      [0.026, 0.0],
      [0.03, 0.03],
      [0.038, 0.09],
      [0.026, 0.18],
      [0.02, 0.24],
      [0.028, 0.3],
      [0.022, 0.345],
      [0.012, 0.375],
      [0.0, 0.38],
    ];
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y - PIN_HEIGHT / 2));
    const geo = new THREE.LatheGeometry(pts, 24);
    geo.computeVertexNormals();
    return geo;
  }

  _buildPins() {
    const geo = this._makePinGeometry();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xfaf7f0,
      roughness: 0.32,
      metalness: 0.02,
    });
    const meshes = [];
    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(geo, bodyMat);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Red neck stripes.
      const stripeMat = new THREE.MeshStandardMaterial({
        color: 0xd6263a,
        roughness: 0.4,
      });
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.006, 8, 24), stripeMat);
      ring1.rotation.x = Math.PI / 2;
      ring1.position.y = 0.07;
      group.add(ring1);
      const ring2 = ring1.clone();
      ring2.position.y = 0.1;
      group.add(ring2);

      this.scene.add(group);
      meshes.push(group);
    }
    return meshes;
  }

  // ---------- Ball ----------
  _buildBall(colorDef) {
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 48, 48);
    const mat = new THREE.MeshPhysicalMaterial({
      color: colorDef.hex,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      sheen: 0.4,
      sheenColor: new THREE.Color(colorDef.accent),
    });
    this.ballSphere = new THREE.Mesh(geo, mat);
    this.ballSphere.castShadow = true;
    group.add(this.ballSphere);

    // Finger holes (three small dark dimples on the "top").
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const holeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12);
    const holePos = [
      [0, BALL_RADIUS - 0.01, 0.02],
      [-0.025, BALL_RADIUS - 0.015, -0.015],
      [0.025, BALL_RADIUS - 0.015, -0.015],
    ];
    for (const [x, y, z] of holePos) {
      const h = new THREE.Mesh(holeGeo, holeMat);
      h.position.set(x, y, z);
      this.ballSphere.add(h);
    }

    this.scene.add(group);
    return group;
  }

  setBallColor(colorDef) {
    this.ballSphere.material.color.set(colorDef.hex);
    this.ballSphere.material.sheenColor.set(colorDef.accent);
  }

  // ---------- Aim arrow (guide) ----------
  _buildAimArrow() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.6,
    });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 1.6), mat);
    shaft.position.z = 0.8;
    group.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), mat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 1.65;
    group.add(head);
    group.visible = false;
    this.scene.add(group);
    return group;
  }

  showAim(x, angle, spin) {
    this.arrow.visible = true;
    this.arrow.position.set(x, 0.05, LANE.approachZ);
    this.arrow.rotation.y = -angle - spin * 0.25;
  }
  hideAim() {
    this.arrow.visible = false;
  }

  // ---------- Frame update ----------
  syncBall(physBall) {
    this.ballMesh.position.set(physBall.pos.x, physBall.pos.y, physBall.pos.z);
    this.ballSphere.rotation.set(
      physBall.rollRot.x,
      physBall.rollRot.y,
      physBall.rollRot.z
    );
  }

  syncPins(pins) {
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      const m = this.pinMeshes[i];
      if (p.removed) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      this._tmpE.set(p.tilt.x, p.spinAngle, p.tilt.z, "XYZ");
      m.quaternion.setFromEuler(this._tmpE);
    }
  }

  render(dt) {
    this._updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
