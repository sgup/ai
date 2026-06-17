/*
 * game.js — 3D bowling renderer + game loop + mouse controls.
 *
 * Classic <script>. Depends on globals: THREE (vendored UMD), Scoring, BowlPhysics.
 * No ES modules / no import maps -> loads fine from file:// (double-click) AND
 * over http. Boots itself on DOMContentLoaded.
 *
 * Mouse model (easy to play):
 *   - Move mouse left/right over the lane  -> aim the ball laterally.
 *   - The aim guide shows the PREDICTED curved path (uses physics.predictPath),
 *     so you aim where the ball will actually end up, hook included.
 *   - Spin slider (or A/D keys) sets hook; power slider (or W/S) sets speed.
 *   - Click + drag DOWN then release, OR just click, to bowl. The power meter
 *     also pulses; release at the top for max power.
 */
(function () {
  "use strict";

  // ---- guard: dependencies present -------------------------------------------
  function fail(msg) {
    var el = document.getElementById("boot-error");
    if (el) {
      el.style.display = "block";
      el.textContent = msg;
    }
    console.error(msg);
  }

  function boot() {
    if (typeof THREE === "undefined") {
      return fail(
        "Three.js failed to load (three.min.js). If you opened this from a CDN-only build, check your connection; this build vendors Three.js locally."
      );
    }
    if (typeof Scoring === "undefined" || typeof BowlPhysics === "undefined") {
      return fail("Game logic failed to load (scoring.js / physics.js).");
    }
    try {
      new Game();
    } catch (e) {
      fail("Startup error: " + (e && e.message ? e.message : e));
      throw e;
    }
  }

  var P = window.BowlPhysics;

  // Scale: physics is in meters; render world uses the same meters directly.
  // Camera sits behind the foul line looking down +z toward the pins.

  function Game() {
    this.canvas = document.getElementById("scene");
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070f);
    this.scene.fog = new THREE.Fog(0x05070f, 14, 30);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.cameraMode = "bowler"; // bowler | overhead

    // game state
    this.frames = [[]]; // array of frame roll arrays
    this.currentFrame = 0;
    this.rollInFrame = 0; // rolls thrown in current frame
    this.pinsStandingBefore = 10; // pins up at start of this ball
    this.state = "aiming"; // aiming | rolling | settling | gameover

    // controls
    this.aimX = 0; // lateral aim at foul line (m)
    this.spin = 0; // -1..1
    this.power = 7.8; // m/s
    this.minPower = 6.2;
    this.maxPower = 9.4;

    this.buildLights();
    this.buildLane();
    this.buildBall();
    this.buildPins();
    this.buildAimGuide();
    this.bindUI();
    this.resize();

    var self = this;
    window.addEventListener("resize", function () {
      self.resize();
    });

    this.clock = new THREE.Clock();
    this.updateScoreboard();
    this.setStatus("Aim with the mouse. Click to bowl.");
    this.animate();
  }

  Game.prototype.buildLights = function () {
    var amb = new THREE.AmbientLight(0x4a5570, 0.7);
    this.scene.add(amb);

    var key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-3, 10, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -22;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    // warm pin-deck spotlight
    var spot = new THREE.SpotLight(0xfff0d0, 1.2, 14, Math.PI / 5, 0.4, 1);
    spot.position.set(0, 6, P.LANE_LENGTH);
    spot.target.position.set(0, 0, P.LANE_LENGTH + 0.6);
    this.scene.add(spot);
    this.scene.add(spot.target);

    // accent lane glow strips (point lights along the gutters)
    var c1 = new THREE.PointLight(0x1f6fff, 0.5, 8);
    c1.position.set(-0.9, 0.6, 6);
    this.scene.add(c1);
    var c2 = new THREE.PointLight(0xff3b6b, 0.5, 8);
    c2.position.set(0.9, 0.6, 12);
    this.scene.add(c2);
  };

  Game.prototype.buildLane = function () {
    var W = P.LANE_WIDTH;
    var L = P.LANE_LENGTH + 2.2; // include pin deck
    var laneGeo = new THREE.PlaneGeometry(W, L);
    // wood-ish gradient via vertex colors / simple material with stripes texture
    var laneMat = new THREE.MeshStandardMaterial({
      color: 0xcaa46a,
      roughness: 0.35,
      metalness: 0.05,
    });
    laneMat.map = this.makeLaneTexture();
    var lane = new THREE.Mesh(laneGeo, laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0, L / 2 - 0.2);
    lane.receiveShadow = true;
    this.scene.add(lane);

    // gutters (two recessed dark troughs)
    var gutMat = new THREE.MeshStandardMaterial({
      color: 0x10131c,
      roughness: 0.6,
      metalness: 0.2,
    });
    for (var s = -1; s <= 1; s += 2) {
      var g = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, L), gutMat);
      g.position.set(s * (W / 2 + 0.07), -0.05, L / 2 - 0.2);
      g.receiveShadow = true;
      this.scene.add(g);
    }

    // side walls / bumpers
    var wallMat = new THREE.MeshStandardMaterial({
      color: 0x161a2a,
      roughness: 0.8,
      metalness: 0.1,
    });
    for (var w = -1; w <= 1; w += 2) {
      var wall = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, L), wallMat);
      wall.position.set(w * (W / 2 + 0.18), 0.18, L / 2 - 0.2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }

    // back wall behind the pins
    var back = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.6, 1.6, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x0b1f3a, roughness: 0.5, metalness: 0.3 })
    );
    back.position.set(0, 0.8, P.LANE_LENGTH + 1.3);
    back.receiveShadow = true;
    this.scene.add(back);

    // foul line (bright strip)
    var foul = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x00ffcc })
    );
    foul.rotation.x = -Math.PI / 2;
    foul.position.set(0, 0.002, 0.02);
    this.scene.add(foul);

    // approach area behind the foul line (where the bowler stands)
    var approach = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.4, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x2a2017, roughness: 0.6 })
    );
    approach.rotation.x = -Math.PI / 2;
    approach.position.set(0, -0.001, -1.1);
    approach.receiveShadow = true;
    this.scene.add(approach);
  };

  // Procedural wood-plank + aiming-arrows texture for the lane.
  Game.prototype.makeLaneTexture = function () {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 2048;
    var ctx = c.getContext("2d");
    // base wood gradient
    var grad = ctx.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, "#d8b87a");
    grad.addColorStop(0.5, "#c39a5c");
    grad.addColorStop(1, "#b88a4e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    // vertical planks
    ctx.strokeStyle = "rgba(80,55,25,0.35)";
    ctx.lineWidth = 1;
    for (var x = 0; x <= c.width; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    // subtle grain noise
    for (var i = 0; i < 4000; i++) {
      ctx.fillStyle = "rgba(60,40,20," + Math.random() * 0.05 + ")";
      ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 1);
    }
    // aiming arrows (the classic 7 dovetail arrows ~ 1/3 down the lane)
    ctx.fillStyle = "#3a2a14";
    var arrowY = c.height * 0.74; // toward pins in texture space
    for (var a = 0; a < 7; a++) {
      var ax = (c.width / 8) * (a + 1);
      var off = Math.abs(a - 3) * 26;
      ctx.beginPath();
      ctx.moveTo(ax, arrowY + off);
      ctx.lineTo(ax - 7, arrowY + off + 22);
      ctx.lineTo(ax + 7, arrowY + off + 22);
      ctx.closePath();
      ctx.fill();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  };

  Game.prototype.buildBall = function () {
    var r = P.BALL_RADIUS;
    var geo = new THREE.SphereGeometry(r, 48, 48);
    this.ballMat = new THREE.MeshStandardMaterial({
      color: 0x1565ff,
      roughness: 0.12,
      metalness: 0.55,
      emissive: 0x06203f,
    });
    this.ballMesh = new THREE.Mesh(geo, this.ballMat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    // finger holes (three small dark spheres) as a child group for spin visual
    this.ballGroup = new THREE.Group();
    this.ballGroup.add(this.ballMesh);
    var holeMat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.9 });
    for (var i = 0; i < 3; i++) {
      var h = new THREE.Mesh(new THREE.SphereGeometry(r * 0.16, 12, 12), holeMat);
      var ang = (i / 3) * Math.PI * 0.6 - 0.3;
      h.position.set(Math.cos(ang) * r * 0.45, r * 0.78, Math.sin(ang) * r * 0.45);
      this.ballMesh.add(h);
    }
    this.scene.add(this.ballGroup);
    this.resetBallVisual();

    this.ballColors = [0x1565ff, 0xff2e63, 0x00d68f, 0xffb400, 0x9b5de5, 0x141821];
    this.ballColorIdx = 0;
  };

  Game.prototype.resetBallVisual = function () {
    this.ballGroup.position.set(this.aimX, P.BALL_RADIUS, 0.0);
    this.ballMesh.rotation.set(0, 0, 0);
  };

  Game.prototype.buildPins = function () {
    this.pinMeshes = [];
    var layout = P.standardPinLayout();
    this.pinGeo = this.makePinGeometry();
    this.pinMat = new THREE.MeshStandardMaterial({
      color: 0xf7f4ee,
      roughness: 0.35,
      metalness: 0.0,
    });
    for (var i = 0; i < layout.length; i++) {
      var m = new THREE.Mesh(this.pinGeo, this.pinMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.pinMeshes.push(m);
    }
    this.physicsPins = layout;
    this.layoutPinVisuals();
  };

  // Pin profile via LatheGeometry (bowling-pin silhouette).
  Game.prototype.makePinGeometry = function () {
    var pts = [];
    var H = 0.38; // pin height (m)
    // profile points (radius, height) from base to top
    var prof = [
      [0.0, 0.0],
      [0.035, 0.0],
      [0.04, 0.03],
      [0.03, 0.10],
      [0.028, 0.16],
      [0.045, 0.24],
      [0.05, 0.28],
      [0.03, 0.33],
      [0.018, 0.37],
      [0.0, H],
    ];
    for (var i = 0; i < prof.length; i++) {
      pts.push(new THREE.Vector2(prof[i][0], prof[i][1]));
    }
    var g = new THREE.LatheGeometry(pts, 24);
    return g;
  };

  Game.prototype.layoutPinVisuals = function () {
    for (var i = 0; i < this.pinMeshes.length; i++) {
      var p = this.physicsPins[i];
      var m = this.pinMeshes[i];
      m.position.set(p.x, 0, p.z);
      m.rotation.set(0, 0, 0);
      m.visible = true;
      m.userData.toppleProgress = 0;
    }
  };

  Game.prototype.buildAimGuide = function () {
    // dotted predicted path line + a target reticle
    this.aimGuide = new THREE.Group();
    var mat = new THREE.LineBasicMaterial({
      color: 0x00ffcc,
      transparent: true,
      opacity: 0.85,
    });
    this.aimLineGeo = new THREE.BufferGeometry();
    this.aimLine = new THREE.Line(this.aimLineGeo, mat);
    this.aimGuide.add(this.aimLine);

    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.08, 24),
      new THREE.MeshBasicMaterial({ color: 0x00ffcc, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    this.aimReticle = ring;
    this.aimGuide.add(ring);
    this.scene.add(this.aimGuide);
  };

  Game.prototype.updateAimGuide = function () {
    var path = P.predictPath(this.aimX, 0, this.power, this.spin);
    var positions = new Float32Array(path.length * 3);
    for (var i = 0; i < path.length; i++) {
      positions[i * 3] = path[i].x;
      positions[i * 3 + 1] = 0.02;
      positions[i * 3 + 2] = path[i].z;
    }
    this.aimLineGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.aimLineGeo.computeBoundingSphere();
    var end = path[path.length - 1];
    this.aimReticle.position.set(end.x, 0.02, end.z);
    var vis = this.state === "aiming";
    this.aimGuide.visible = vis;
  };

  // -------- UI / input --------------------------------------------------------
  Game.prototype.bindUI = function () {
    var self = this;

    // mouse aim: map cursor x to lateral aim, only when over the canvas
    this.canvas.addEventListener("mousemove", function (e) {
      if (self.state !== "aiming") return;
      var rect = self.canvas.getBoundingClientRect();
      var nx = (e.clientX - rect.left) / rect.width; // 0..1
      // map to a comfortable aim band (slightly wider than the lane)
      self.aimX = (nx - 0.5) * (P.LANE_WIDTH * 1.1);
      self.aimX = P.clamp(self.aimX, -P.GUTTER_HALF * 1.2, P.GUTTER_HALF * 1.2);
      self.resetBallVisual();
    });

    this.canvas.addEventListener("click", function () {
      if (self.state === "aiming") self.bowl();
    });

    // sliders
    var spinEl = document.getElementById("spin");
    var powerEl = document.getElementById("power");
    if (spinEl)
      spinEl.addEventListener("input", function () {
        self.spin = parseFloat(spinEl.value);
        self.updateHud();
      });
    if (powerEl)
      powerEl.addEventListener("input", function () {
        var t = parseFloat(powerEl.value); // 0..1
        self.power = self.minPower + t * (self.maxPower - self.minPower);
        self.updateHud();
      });

    // buttons
    var nb = document.getElementById("btn-new");
    if (nb) nb.addEventListener("click", function () { self.newGame(); });
    var pa = document.getElementById("btn-play-again");
    if (pa) pa.addEventListener("click", function () { self.newGame(); });
    var cb = document.getElementById("btn-cam");
    if (cb) cb.addEventListener("click", function () { self.toggleCamera(); });
    var bb = document.getElementById("btn-ball");
    if (bb) bb.addEventListener("click", function () { self.cycleBallColor(); });
    var rb = document.getElementById("btn-bowl");
    if (rb) rb.addEventListener("click", function () { if (self.state === "aiming") self.bowl(); });

    // keyboard niceties
    window.addEventListener("keydown", function (e) {
      if (self.state === "aiming") {
        if (e.key === "a" || e.key === "ArrowLeft") { self.aimX -= 0.03; self.resetBallVisual(); }
        if (e.key === "d" || e.key === "ArrowRight") { self.aimX += 0.03; self.resetBallVisual(); }
        if (e.key === " ") { e.preventDefault(); self.bowl(); }
      }
      if (e.key === "c") self.toggleCamera();
      if (e.key === "n") self.newGame();
    });

    this.updateHud();
  };

  Game.prototype.updateHud = function () {
    var st = document.getElementById("spin-val");
    if (st) st.textContent = (this.spin > 0 ? "+" : "") + this.spin.toFixed(2);
    var pt = document.getElementById("power-val");
    if (pt) {
      var pct = Math.round(((this.power - this.minPower) / (this.maxPower - this.minPower)) * 100);
      pt.textContent = pct + "%";
    }
  };

  Game.prototype.cycleBallColor = function () {
    this.ballColorIdx = (this.ballColorIdx + 1) % this.ballColors.length;
    var hex = this.ballColors[this.ballColorIdx];
    this.ballMat.color.setHex(hex);
    // dim emissive of the same hue so the ball reads as glossy, not flat
    this.ballMat.emissive.setHex(hex).multiplyScalar(0.12);
  };

  Game.prototype.toggleCamera = function () {
    this.cameraMode = this.cameraMode === "bowler" ? "overhead" : "bowler";
  };

  // -------- bowling action ----------------------------------------------------
  Game.prototype.bowl = function () {
    if (this.state !== "aiming") return;
    this.state = "rolling";
    this.setStatus("");
    this.aimGuide.visible = false;
    this.physBall = P.createBall(this.aimX, 0, this.power, this.spin);
    this.rollTime = 0;
    // record pins standing before this ball (for split/score display)
    this.pinsStandingBefore = 10 - P.countDown(this.physicsPins);
    this.settleTimer = 0;
  };

  // step physics for the active roll, sync meshes
  Game.prototype.stepRoll = function (dt) {
    // sub-step for stability
    var sub = 4;
    var h = dt / sub;
    for (var i = 0; i < sub; i++) {
      P.step(this.physBall, this.physicsPins, h);
    }
    // ball mesh
    var b = this.physBall;
    this.ballGroup.position.set(b.x, P.BALL_RADIUS, b.z);
    // rolling rotation: roll about lateral axis proportional to forward travel
    var roll = (b.vz * dt) / P.BALL_RADIUS;
    this.ballMesh.rotation.x += roll;
    // spin tilt about vertical for visual hook
    this.ballMesh.rotation.y += b.spin * dt * 2.0;
    if (b.inGutter) this.ballGroup.position.x = b.x; // already railed

    this.syncPinVisuals(dt);

    if (b.stopped) {
      this.state = "settling";
      this.settleTimer = 0;
    }
  };

  Game.prototype.syncPinVisuals = function (dt) {
    for (var i = 0; i < this.physicsPins.length; i++) {
      var p = this.physicsPins[i];
      var m = this.pinMeshes[i];
      if (p.down) {
        // animate topple: slide to physics pos + fall over
        m.position.x += (p.x - m.position.x) * Math.min(1, dt * 8);
        m.position.z += (p.z - m.position.z) * Math.min(1, dt * 8);
        var tp = (m.userData.toppleProgress = Math.min(1, (m.userData.toppleProgress || 0) + dt * 5));
        // fall in the direction of motion
        var dir = Math.atan2(p.vx, p.vz || 0.0001);
        m.rotation.z = -Math.cos(dir) * tp * (Math.PI / 2) * (p.vx >= 0 ? 1 : 1);
        m.rotation.x = Math.cos(dir) * 0; // keep simple
        // tip over: rotate around the horizontal axis perpendicular to motion
        m.rotation.x = (tp * Math.PI) / 2 * (p.vz >= 0 ? 1 : -1) * Math.abs(Math.cos(dir));
        m.rotation.z = (tp * Math.PI) / 2 * Math.sin(dir);
        m.position.y = -Math.sin(tp * Math.PI) * 0.02; // tiny dip
      } else {
        m.position.set(p.x, 0, p.z);
      }
    }
  };

  // -------- frame / scoring flow ---------------------------------------------
  Game.prototype.recordRoll = function () {
    var knockedNow = P.countDown(this.physicsPins);
    var pinsThisBall = knockedNow - (10 - this.pinsStandingBefore);
    pinsThisBall = Math.max(0, Math.min(pinsThisBall, this.pinsStandingBefore));

    var frame = this.frames[this.currentFrame];
    frame.push(pinsThisBall);

    var isTenth = this.currentFrame === 9;
    var done = false;

    if (!isTenth) {
      if (pinsThisBall === 10 && frame.length === 1) {
        // strike -> frame over
        done = true;
        this.flashMessage("STRIKE!", "#ffcf5a");
      } else if (frame.length === 2) {
        if (frame[0] + frame[1] === 10) this.flashMessage("SPARE", "#00ffcc");
        done = true;
      }
    } else {
      // 10th frame logic: up to 3 balls
      var sum2 = (frame[0] || 0) + (frame[1] || 0);
      if (frame.length === 1) {
        if (frame[0] === 10) this.flashMessage("STRIKE!", "#ffcf5a");
        done = false;
      } else if (frame.length === 2) {
        if (frame[0] === 10 || sum2 === 10) {
          if (sum2 === 10 && frame[0] !== 10) this.flashMessage("SPARE", "#00ffcc");
          done = false; // earns a third ball
        } else {
          done = true; // open frame, no bonus
        }
      } else {
        done = true; // third ball thrown
      }
    }

    this.updateScoreboard();

    if (done) {
      this.advanceFrame();
    } else {
      this.nextBallSameFrame();
    }
  };

  // reset only the standing pins' need to be re-racked? No: between balls in a
  // frame, knocked pins are cleared (swept) but standing pins remain.
  Game.prototype.nextBallSameFrame = function () {
    var self = this;
    // sweep knocked pins (hide them), keep standing pins in place
    for (var i = 0; i < this.physicsPins.length; i++) {
      if (this.physicsPins[i].down) this.pinMeshes[i].visible = false;
    }
    this.rollInFrame++;
    this.pinsStandingBefore = 10 - P.countDown(this.physicsPins);

    // 10th-frame special: if a strike/spare cleared the rack, re-rack fully
    var frame = this.frames[this.currentFrame];
    if (this.currentFrame === 9) {
      var reRack =
        frame[frame.length - 1] === 10 || // last ball was a strike
        (frame.length === 2 && frame[0] + frame[1] === 10); // spare completed
      if (reRack) {
        this.fullRack();
      }
    }
    this.resetForAim();
  };

  Game.prototype.advanceFrame = function () {
    if (this.currentFrame >= 9) {
      this.endGame();
      return;
    }
    this.currentFrame++;
    this.frames.push([]);
    this.rollInFrame = 0;
    this.fullRack();
    this.resetForAim();
  };

  Game.prototype.fullRack = function () {
    this.physicsPins = P.standardPinLayout();
    this.layoutPinVisuals();
    this.pinsStandingBefore = 10;
  };

  Game.prototype.resetForAim = function () {
    this.state = "aiming";
    this.aimX = P.clamp(this.aimX, -P.GUTTER_HALF * 0.6, P.GUTTER_HALF * 0.6);
    this.resetBallVisual();
    this.ballMesh.rotation.set(0, 0, 0);
    var standing = 10 - P.countDown(this.physicsPins);
    this.setStatus(
      "Frame " + (this.currentFrame + 1) + " — " + standing + " pin" + (standing === 1 ? "" : "s") +
      " standing. Aim and click to bowl."
    );
  };

  Game.prototype.endGame = function () {
    this.state = "gameover";
    var total = Scoring.totalScore(this.frames);
    var rating =
      total >= 250 ? "Phenomenal!" :
      total >= 200 ? "Outstanding!" :
      total >= 150 ? "Great game!" :
      total >= 100 ? "Nice rolling!" :
      "Keep practicing!";
    var over = document.getElementById("gameover");
    if (over) {
      document.getElementById("final-score").textContent = total;
      document.getElementById("final-rating").textContent = rating;
      over.style.display = "flex";
    }
    this.aimGuide.visible = false;
  };

  Game.prototype.newGame = function () {
    this.frames = [[]];
    this.currentFrame = 0;
    this.rollInFrame = 0;
    this.fullRack();
    var over = document.getElementById("gameover");
    if (over) over.style.display = "none";
    this.aimX = 0;
    this.spin = 0;
    var spinEl = document.getElementById("spin");
    if (spinEl) spinEl.value = "0";
    this.updateHud();
    this.updateScoreboard();
    this.resetForAim();
  };

  // -------- scoreboard --------------------------------------------------------
  Game.prototype.updateScoreboard = function () {
    var scores = Scoring.frameScores(this.frames);
    var cum = 0;
    for (var f = 0; f < 10; f++) {
      var frame = this.frames[f] || [];
      var cell = document.getElementById("frame-" + f);
      if (!cell) continue;
      var b1 = cell.querySelector(".b1");
      var b2 = cell.querySelector(".b2");
      var b3 = cell.querySelector(".b3");
      var tot = cell.querySelector(".ftot");

      b1.textContent = rollMark(frame, 0, f);
      b2.textContent = rollMark(frame, 1, f);
      if (b3) b3.textContent = f === 9 ? rollMark(frame, 2, f) : "";

      var sc = scores[f];
      tot.textContent = sc === null || sc === undefined ? "" : sc;
      cell.classList.toggle("active", f === this.currentFrame && this.state !== "gameover");
    }
    var totalEl = document.getElementById("total-score");
    if (totalEl) totalEl.textContent = Scoring.totalScore(this.frames);
  };

  function rollMark(frame, idx, frameIdx) {
    if (idx >= frame.length) return "";
    var v = frame[idx];
    var isTenth = frameIdx === 9;
    if (!isTenth) {
      if (idx === 0 && v === 10) return "X";
      if (idx === 1 && frame[0] + v === 10) return "/";
      return v === 0 ? "-" : String(v);
    } else {
      // tenth frame: each strike is X, spare on 2nd is /, etc.
      if (v === 10) return "X";
      if (idx === 1 && frame[0] !== 10 && frame[0] + v === 10) return "/";
      if (idx === 2) {
        var prev = frame[1];
        if (prev !== 10 && frame[0] !== 10 && prev + v === 10) return "/";
      }
      return v === 0 ? "-" : String(v);
    }
  }

  // -------- status / message helpers -----------------------------------------
  Game.prototype.setStatus = function (msg) {
    var el = document.getElementById("status");
    if (el) el.textContent = msg;
  };

  Game.prototype.flashMessage = function (text, color) {
    var el = document.getElementById("flash");
    if (!el) return;
    el.textContent = text;
    el.style.color = color || "#fff";
    el.classList.remove("show");
    // force reflow to restart animation
    void el.offsetWidth;
    el.classList.add("show");
  };

  // -------- camera ------------------------------------------------------------
  Game.prototype.updateCamera = function (dt) {
    var target = new THREE.Vector3();
    var look = new THREE.Vector3();
    if (this.cameraMode === "overhead") {
      target.set(0, 9, P.LANE_LENGTH * 0.55);
      look.set(0, 0, P.LANE_LENGTH * 0.6);
    } else {
      // bowler view: lower and further back so the ball at the foul line stays
      // fully in frame; gently follows the ball down the lane while rolling.
      var followZ = this.state === "rolling" ? Math.min(this.physBall.z * 0.4, 6) : 0;
      target.set(this.aimX * 0.3, 1.15, -3.0 + followZ);
      look.set(this.aimX * 0.2, 0.25, P.LANE_LENGTH * 0.72);
    }
    this.camera.position.lerp(target, Math.min(1, dt * 3));
    this._look = this._look || look.clone();
    this._look.lerp(look, Math.min(1, dt * 3));
    this.camera.lookAt(this._look);
  };

  // -------- main loop ---------------------------------------------------------
  Game.prototype.animate = function () {
    var self = this;
    function frame() {
      requestAnimationFrame(frame);
      var dt = Math.min(self.clock.getDelta(), 1 / 30);
      self.tick(dt);
      self.renderer.render(self.scene, self.camera);
    }
    frame();
  };

  Game.prototype.tick = function (dt) {
    if (this.state === "aiming") {
      this.updateAimGuide();
    } else if (this.state === "rolling") {
      this.rollTime += dt;
      this.stepRoll(dt);
    } else if (this.state === "settling") {
      // keep stepping pins until they rest, then record
      this.settleTimer += dt;
      for (var i = 0; i < 3; i++) P.stepPins(this.physicsPins, dt / 3);
      this.syncPinVisuals(dt);
      if (this.settleTimer > 1.1) {
        this.state = "scoring";
        this.recordRoll();
      }
    }
    this.updateCamera(dt);
  };

  // -------- resize ------------------------------------------------------------
  Game.prototype.resize = function () {
    var w = window.innerWidth;
    var h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
