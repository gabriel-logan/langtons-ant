/*
 * Runs both the simulation (WASM) and rendering (WebGL2 on an OffscreenCanvas)
 * off the main thread. Sharing one thread means the GPU reads the grid straight
 * from WASM memory, with no copies between threads.
 */
import { Cmd, Evt, Defaults, SimStatus } from '../shared/protocol.js';
import { Simulation } from './simulation.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';

const FRAME_BUDGET_MS = 10;
const CHUNK = 1 << 15;
const SMOOTH_MAX_SPS = 30;
const STATS_INTERVAL_MS = 100;
const TWO_PI = Math.PI * 2;

function nextFrame(callback) {
  if (self.requestAnimationFrame) {
    self.requestAnimationFrame(callback);
    return;
  }
  setTimeout(() => {
    callback(performance.now());
  }, 16);
}

function dirToAngle(dir) {
  return (dir * Math.PI) / 2;
}

class App {
  constructor(sim, renderer, maxGridSize) {
    this.sim = sim;
    this.renderer = renderer;
    this.camera = new Camera();
    this.maxGridSize = maxGridSize;

    this.running = false;
    this.stepsPerSecond = 1000;
    this.accumulator = 0;

    this.angle = dirToAngle(sim.dir);
    this.anim = { fromX: 0, fromY: 0, fromAngle: 0, toAngle: 0, startedAt: 0, duration: 0 };

    this.rate = { windowStart: performance.now(), windowSteps: 0, value: 0 };
    this.lastStatsAt = 0;
    this.lastFrameAt = performance.now();
    this.needsRender = true;

    this.camera.reset(sim.x + 0.5, sim.y + 0.5);
  }

  start() {
    if (this.sim.status !== SimStatus.OK) {
      return;
    }
    this.running = true;
    this.accumulator = 0;
    this.publishStats(true);
  }

  stop() {
    this.running = false;
    this.publishStats(true);
  }

  restart() {
    this.sim.reset();
    this.accumulator = 0;
    this.angle = dirToAngle(this.sim.dir);
    this.anim.duration = 0;
    this.rate.value = 0;
    this.camera.reset(this.sim.x + 0.5, this.sim.y + 0.5);
    this.needsRender = true;
    this.publishStats(true);
  }

  setSpeed(stepsPerSecond) {
    this.stepsPerSecond = stepsPerSecond;
    this.accumulator = 0;
  }

  setMaxSteps(value) {
    this.sim.setMaxSteps(value);
    this.publishStats(true);
  }

  setFollow(enabled) {
    this.camera.follow = enabled;
    this.needsRender = true;
    this.publishStats(true);
  }

  pan(dx, dy) {
    this.camera.follow = false;
    this.camera.pan(dx, dy);
    this.needsRender = true;
    this.publishStats(true);
  }

  zoom(factor, x, y) {
    this.camera.zoomAt(factor, x, y);
    this.needsRender = true;
    this.publishStats(true);
  }

  resize(width, height, dpr) {
    this.camera.setViewport(width, height);
    this.renderer.resize(width, height, dpr);
    this.needsRender = true;
  }

  #runSteps(n, deadline) {
    let done = 0;

    while (done < n) {
      const executed = this.sim.step(Math.min(CHUNK, n - done));
      done += executed;

      if (executed === 0 || performance.now() >= deadline) {
        break;
      }
    }
    return done;
  }

  #stepTarget(dt) {
    if (this.stepsPerSecond === Infinity) {
      return 0xffffffff;
    }
    this.accumulator += this.stepsPerSecond * dt;
    const target = Math.floor(this.accumulator);
    this.accumulator -= target;
    return Math.min(target, 0xffffffff);
  }

  /** Continuous angle, so going west -> north turns 90° instead of -270°. */
  #updateAngle() {
    const current = ((this.angle % TWO_PI) + TWO_PI) % TWO_PI;
    let delta = dirToAngle(this.sim.dir) - current;

    if (delta > Math.PI) {
      delta -= TWO_PI;
    }
    if (delta < -Math.PI) {
      delta += TWO_PI;
    }
    this.angle += delta;
  }

  #simulate(dt, now) {
    if (!this.running) {
      return 0;
    }

    const target = this.#stepTarget(dt);
    if (target === 0) {
      return 0;
    }

    const prevX = this.sim.x;
    const prevY = this.sim.y;
    const prevAngle = this.angle;
    const done = this.#runSteps(target, now + FRAME_BUDGET_MS);

    // Drop what did not fit in the frame budget instead of piling it up.
    if (done < target) {
      this.accumulator = 0;
    }

    this.#updateAngle();

    if (done === 1 && this.stepsPerSecond <= SMOOTH_MAX_SPS) {
      this.anim = {
        fromX: prevX,
        fromY: prevY,
        fromAngle: prevAngle,
        toAngle: this.angle,
        startedAt: now,
        duration: Math.min(250, 1000 / this.stepsPerSecond),
      };
    } else if (done > 0) {
      this.anim.duration = 0;
    }

    if (this.sim.status !== SimStatus.OK) {
      this.running = false;
      this.publishStats(true);
    }
    return done;
  }

  #antPose(now) {
    const a = this.anim;
    const x = this.sim.x;
    const y = this.sim.y;

    if (a.duration <= 0) {
      return { x, y, angle: this.angle };
    }

    const t = Math.min(1, (now - a.startedAt) / a.duration);
    const e = t * t * (3 - 2 * t);

    if (t >= 1) {
      a.duration = 0;
    } else {
      this.needsRender = true;
    }

    return {
      x: a.fromX + (x - a.fromX) * e,
      y: a.fromY + (y - a.fromY) * e,
      angle: a.fromAngle + (a.toAngle - a.fromAngle) * Math.min(1, e * 1.6),
    };
  }

  #trackRate(done, now) {
    const r = this.rate;
    r.windowSteps += done;

    const elapsed = now - r.windowStart;
    if (elapsed >= 500) {
      r.value = (r.windowSteps * 1000) / elapsed;
      r.windowSteps = 0;
      r.windowStart = now;
    }

    if (!this.running) {
      r.value = 0;
    }
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;

    const done = this.#simulate(dt, now);
    this.#trackRate(done, now);

    const pose = this.#antPose(now);
    if (this.camera.update(dt, pose.x + 0.5, pose.y + 0.5)) {
      this.needsRender = true;
    }
    if (this.renderer.sync(this.sim)) {
      this.needsRender = true;
    }

    // While running the marker pulses, so always draw; when idle, only on changes.
    if (this.needsRender || this.running) {
      this.renderer.draw(this.camera, pose, now / 1000);
      this.needsRender = false;
    }

    this.publishStats();
    nextFrame((t) => {
      this.frame(t);
    });
  }

  publishStats(force = false) {
    const now = performance.now();

    if (!force && now - this.lastStatsAt < STATS_INTERVAL_MS) {
      return;
    }
    this.lastStatsAt = now;

    const s = this.sim;
    self.postMessage({
      type: Evt.STATS,
      running: this.running,
      status: s.status,
      steps: s.steps,
      maxSteps: s.maxSteps,
      x: s.x,
      y: s.y,
      dir: s.dir,
      blackCells: s.blackCells,
      gridSize: s.grid.size,
      maxGridSize: this.maxGridSize,
      highwayStep: s.highwayStep,
      actualRate: this.rate.value,
      zoom: this.camera.zoom,
      follow: this.camera.follow,
    });
  }
}

let app = null;
const pending = [];

function dispatch(msg) {
  switch (msg.type) {
    case Cmd.START: {
      app.start();
      break;
    }
    case Cmd.STOP: {
      app.stop();
      break;
    }
    case Cmd.RESTART: {
      app.restart();
      break;
    }
    case Cmd.SET_SPEED: {
      app.setSpeed(msg.stepsPerSecond);
      break;
    }
    case Cmd.SET_MAX_STEPS: {
      app.setMaxSteps(msg.value);
      break;
    }
    case Cmd.SET_FOLLOW: {
      app.setFollow(msg.enabled);
      break;
    }
    case Cmd.PAN: {
      app.pan(msg.dx, msg.dy);
      break;
    }
    case Cmd.ZOOM: {
      app.zoom(msg.factor, msg.x, msg.y);
      break;
    }
    case Cmd.RESIZE: {
      app.resize(msg.width, msg.height, msg.dpr);
      break;
    }
    default: {
      console.warn('Unknown command:', msg);
    }
  }
}

async function init(msg) {
  const renderer = new Renderer(msg.canvas);
  const maxGridSize = Math.min(Defaults.MAX_GRID_SIZE, renderer.maxTextureSize);
  const sim = await Simulation.create(maxGridSize, msg.maxSteps);

  app = new App(sim, renderer, maxGridSize);
  app.setSpeed(msg.stepsPerSecond);
  app.resize(msg.width, msg.height, msg.dpr);

  self.postMessage({ type: Evt.READY, maxGridSize });

  // Commands that arrived while the WASM module was loading.
  for (const queued of pending.splice(0)) {
    dispatch(queued);
  }

  app.publishStats(true);
  nextFrame((t) => {
    app.frame(t);
  });
}

self.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === Cmd.INIT) {
    init(msg).catch((err) => {
      self.postMessage({ type: Evt.ERROR, message: err?.message ?? String(err) });
    });
    return;
  }

  if (!app) {
    pending.push(msg);
    return;
  }
  dispatch(msg);
};
