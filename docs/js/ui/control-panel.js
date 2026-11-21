import { Defaults, Direction, SimStatus, Speed } from '../shared/protocol.js';
import { fmtInt, fmtRate, fmtZoom } from './format.js';

function byId(id) {
  const el = document.getElementById(id);

  if (!el) {
    throw new Error(`Element #${id} not found`);
  }
  return el;
}

function statusLabel(s) {
  if (s.running) {
    return { state: 'running', label: 'Running' };
  }
  if (s.status === SimStatus.MAX_STEPS) {
    return { state: 'done', label: 'Step limit reached' };
  }
  if (s.status === SimStatus.GRID_LIMIT) {
    return { state: 'done', label: 'Grid limit reached' };
  }
  if (s.status === SimStatus.OUT_OF_MEMORY) {
    return { state: 'error', label: 'Out of memory' };
  }
  if (s.steps === 0) {
    return { state: 'paused', label: 'Ready' };
  }
  return { state: 'paused', label: 'Paused' };
}

function phaseLabel(s) {
  let text = 'Chaos (pseudo-random behavior)';

  if (s.highwayStep > 0) {
    text = `Highway — emerged around step ${fmtInt(s.highwayStep)}`;
  } else if (s.steps === 0) {
    text = 'Waiting to start';
  }

  if (s.status === SimStatus.GRID_LIMIT) {
    text += ' · grid edge reached';
  }
  return text;
}

/**
 * Binds the side panel to the app actions and renders worker stats.
 * actions: { start, stop, restart, setSpeed, setMaxSteps, setFollow, zoom }
 */
export class ControlPanel {
  constructor(actions) {
    this.actions = actions;
    this.stats = null;
    this.el = {
      panel: byId('panel'),
      toggle: byId('panel-toggle'),
      status: byId('status'),
      start: byId('btn-start'),
      stop: byId('btn-stop'),
      restart: byId('btn-restart'),
      speed: byId('speed'),
      speedValue: byId('speed-value'),
      maxForm: byId('max-steps-form'),
      maxInput: byId('max-steps'),
      maxHint: byId('max-steps-hint'),
      progress: byId('progress'),
      progressBar: byId('progress-bar'),
      follow: byId('cam-follow'),
      free: byId('cam-free'),
      zoomIn: byId('zoom-in'),
      zoomOut: byId('zoom-out'),
      zoomValue: byId('zoom-value'),
      steps: byId('stat-steps'),
      rate: byId('stat-rate'),
      pos: byId('stat-pos'),
      dir: byId('stat-dir'),
      black: byId('stat-black'),
      grid: byId('stat-grid'),
      phase: byId('stat-phase'),
      toast: byId('toast'),
    };
    this.#bind();
  }

  #bind() {
    const el = this.el;
    const actions = this.actions;

    el.start.addEventListener('click', () => {
      actions.start();
    });
    el.stop.addEventListener('click', () => {
      actions.stop();
    });
    el.restart.addEventListener('click', () => {
      actions.restart();
    });

    el.speed.min = String(Speed.SLIDER_MIN);
    el.speed.max = String(Speed.SLIDER_MAX);
    el.speed.step = '1';
    el.speed.value = String(Speed.SLIDER_DEFAULT);
    el.speed.addEventListener('input', () => {
      this.#onSpeed();
    });
    this.#onSpeed();

    el.maxInput.placeholder = `${fmtInt(Defaults.MAX_STEPS)} (default)`;
    el.maxForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#applyMaxSteps();
      el.maxInput.blur();
    });
    el.maxInput.addEventListener('change', () => {
      this.#applyMaxSteps();
    });

    el.follow.addEventListener('click', () => {
      actions.setFollow(true);
    });
    el.free.addEventListener('click', () => {
      actions.setFollow(false);
    });
    el.zoomIn.addEventListener('click', () => {
      actions.zoom(1.5);
    });
    el.zoomOut.addEventListener('click', () => {
      actions.zoom(1 / 1.5);
    });

    el.toggle.addEventListener('click', () => {
      this.togglePanel();
    });
  }

  #onSpeed() {
    const value = Number(this.el.speed.value);
    const stepsPerSecond = Speed.fromSlider(value);

    this.el.speedValue.textContent = fmtRate(stepsPerSecond);
    this.el.speed.style.setProperty('--fill', `${(value / Speed.SLIDER_MAX) * 100}%`);
    this.actions.setSpeed(stepsPerSecond);
  }

  /** Empty field means the safe default limit; returns null when invalid. */
  #readMaxSteps() {
    const raw = this.el.maxInput.value.trim();

    if (raw === '') {
      return Defaults.MAX_STEPS;
    }

    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) {
      return null;
    }
    return n;
  }

  #applyMaxSteps() {
    const n = this.#readMaxSteps();

    this.el.maxInput.setAttribute('aria-invalid', String(n === null));
    if (n !== null) {
      this.actions.setMaxSteps(n);
    }
  }

  get initialSpeed() {
    return Speed.fromSlider(Number(this.el.speed.value));
  }

  get initialMaxSteps() {
    return this.#readMaxSteps() ?? Defaults.MAX_STEPS;
  }

  togglePanel() {
    const hidden = this.el.panel.classList.toggle('is-hidden');
    this.el.toggle.setAttribute('aria-expanded', String(!hidden));
  }

  nudgeSpeed(delta) {
    const slider = this.el.speed;
    const next = Number(slider.value) + delta;

    slider.value = String(Math.min(Speed.SLIDER_MAX, Math.max(Speed.SLIDER_MIN, next)));
    this.#onSpeed();
  }

  showError(message) {
    this.el.toast.textContent = message;
    this.el.toast.hidden = false;
    this.el.status.dataset.state = 'error';
    this.el.status.textContent = 'Error';
  }

  render(s) {
    const el = this.el;
    const finished = s.status !== SimStatus.OK;
    const status = statusLabel(s);

    this.stats = s;

    el.status.dataset.state = status.state;
    el.status.textContent = status.label;
    el.start.disabled = s.running || finished;
    el.stop.disabled = !s.running;
    el.restart.disabled = s.steps === 0 && !s.running;

    let pct = 0;
    if (s.maxSteps > 0) {
      pct = Math.min(100, (s.steps / s.maxSteps) * 100);
    }
    el.progressBar.style.width = `${pct}%`;
    el.progress.setAttribute('aria-valuenow', pct.toFixed(1));
    el.maxHint.textContent = `limit: ${fmtInt(s.maxSteps)}`;

    el.follow.setAttribute('aria-checked', String(s.follow));
    el.free.setAttribute('aria-checked', String(!s.follow));
    el.zoomValue.textContent = fmtZoom(s.zoom);

    el.steps.textContent = fmtInt(s.steps);
    el.rate.textContent = '—';
    if (s.running) {
      el.rate.textContent = fmtRate(Math.round(s.actualRate));
    }
    el.pos.textContent = `(${fmtInt(s.x)}, ${fmtInt(s.y)})`;
    el.dir.textContent = Direction[s.dir];
    el.black.textContent = fmtInt(s.blackCells);
    el.grid.textContent = `${s.gridSize}² / ${s.maxGridSize}²`;
    el.phase.textContent = phaseLabel(s);
    el.phase.classList.toggle('phase--highway', s.highwayStep > 0);
  }
}
