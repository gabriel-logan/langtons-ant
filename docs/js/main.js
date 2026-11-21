import { Cmd, Evt } from './shared/protocol.js';
import { ControlPanel } from './ui/control-panel.js';
import { attachCanvasInput } from './ui/canvas-input.js';

const ZOOM_STEP = 1.5;
const KEY_PAN_PX = 60;

function unsupportedReason(canvas) {
  if (!('transferControlToOffscreen' in canvas)) {
    return 'Your browser does not support OffscreenCanvas. Use a recent version of Chrome, Edge, Firefox or Safari.';
  }
  if (typeof WebAssembly !== 'object') {
    return 'Your browser does not support WebAssembly.';
  }
  return null;
}

function main() {
  const canvas = document.getElementById('view');
  const worker = new Worker(new URL('./worker/sim-worker.js', import.meta.url), { type: 'module' });

  function send(type, payload = {}, transfer = []) {
    worker.postMessage({ type, ...payload }, transfer);
  }

  function zoom(factor, x, y) {
    send(Cmd.ZOOM, { factor, x, y });
  }

  // Coalesce drag events into a single message per frame.
  let panDx = 0;
  let panDy = 0;
  let panQueued = false;

  function pan(dx, dy) {
    panDx += dx;
    panDy += dy;

    if (panQueued) {
      return;
    }
    panQueued = true;

    requestAnimationFrame(() => {
      send(Cmd.PAN, { dx: panDx, dy: panDy });
      panDx = 0;
      panDy = 0;
      panQueued = false;
    });
  }

  const panel = new ControlPanel({
    start() {
      send(Cmd.START);
    },
    stop() {
      send(Cmd.STOP);
    },
    restart() {
      send(Cmd.RESTART);
    },
    setSpeed(stepsPerSecond) {
      send(Cmd.SET_SPEED, { stepsPerSecond });
    },
    setMaxSteps(value) {
      send(Cmd.SET_MAX_STEPS, { value });
    },
    setFollow(enabled) {
      send(Cmd.SET_FOLLOW, { enabled });
    },
    zoom(factor) {
      zoom(factor);
    },
  });

  const unsupported = unsupportedReason(canvas);
  if (unsupported) {
    panel.showError(unsupported);
    worker.terminate();
    return;
  }

  worker.addEventListener('message', (event) => {
    const msg = event.data;

    if (msg.type === Evt.STATS) {
      panel.render(msg);
    } else if (msg.type === Evt.ERROR) {
      panel.showError(msg.message);
    }
  });

  worker.addEventListener('error', (event) => {
    const detail = event.message || 'make sure the WASM module was built (make).';
    panel.showError(`Worker failed: ${detail}`);
  });

  const offscreen = canvas.transferControlToOffscreen();
  const rect = canvas.getBoundingClientRect();
  send(Cmd.INIT, {
    canvas: offscreen,
    width: rect.width,
    height: rect.height,
    dpr: window.devicePixelRatio || 1,
    maxSteps: panel.initialMaxSteps,
    stepsPerSecond: panel.initialSpeed,
  }, [offscreen]);

  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    send(Cmd.RESIZE, { width, height, dpr: window.devicePixelRatio || 1 });
  });
  observer.observe(canvas);

  attachCanvasInput(canvas, { pan, zoom });

  const shortcuts = {
    ' '() {
      if (!panel.stats) {
        return;
      }
      if (panel.stats.running) {
        send(Cmd.STOP);
      } else {
        send(Cmd.START);
      }
    },
    r() {
      send(Cmd.RESTART);
    },
    f() {
      if (panel.stats) {
        send(Cmd.SET_FOLLOW, { enabled: !panel.stats.follow });
      }
    },
    h() {
      panel.togglePanel();
    },
    '+'() {
      zoom(ZOOM_STEP);
    },
    '='() {
      zoom(ZOOM_STEP);
    },
    '-'() {
      zoom(1 / ZOOM_STEP);
    },
    '_'() {
      zoom(1 / ZOOM_STEP);
    },
    '['() {
      panel.nudgeSpeed(-5);
    },
    ']'() {
      panel.nudgeSpeed(5);
    },
    ArrowLeft() {
      pan(KEY_PAN_PX, 0);
    },
    ArrowRight() {
      pan(-KEY_PAN_PX, 0);
    },
    ArrowUp() {
      pan(0, KEY_PAN_PX);
    },
    ArrowDown() {
      pan(0, -KEY_PAN_PX);
    },
  };

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    let key = event.key;
    if (key.length === 1) {
      key = key.toLowerCase();
    }

    const handler = shortcuts[key];
    if (!handler) {
      return;
    }

    event.preventDefault();
    handler();
  });
}

main();
