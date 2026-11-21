/** Messages sent from the main thread to the worker. */
export const Cmd = Object.freeze({
  INIT: 'init',
  START: 'start',
  STOP: 'stop',
  RESTART: 'restart',
  SET_SPEED: 'set-speed',
  SET_MAX_STEPS: 'set-max-steps',
  RESIZE: 'resize',
  PAN: 'pan',
  ZOOM: 'zoom',
  SET_FOLLOW: 'set-follow',
});

/** Messages sent from the worker to the main thread. */
export const Evt = Object.freeze({
  READY: 'ready',
  STATS: 'stats',
  ERROR: 'error',
});

/** Mirrors LgStatus in src/langton.h */
export const SimStatus = Object.freeze({
  OK: 0,
  MAX_STEPS: 1,
  GRID_LIMIT: 2,
  OUT_OF_MEMORY: 3,
});

export const Direction = Object.freeze(['North', 'East', 'South', 'West']);

export const Defaults = Object.freeze({
  // Fits in an 8192² grid, which reaches ~428k steps.
  MAX_STEPS: 400_000,
  MAX_GRID_SIZE: 8192,
  ZOOM: 6,
  MIN_ZOOM: 0.04,
  MAX_ZOOM: 96,
});

/** Logarithmic speed slider; the last position means "as fast as possible". */
export const Speed = Object.freeze({
  SLIDER_MIN: 0,
  SLIDER_MAX: 61,
  SLIDER_DEFAULT: 33,

  fromSlider(value) {
    if (value >= this.SLIDER_MAX) {
      return Infinity;
    }
    return Math.round(10 ** (value / 10));
  },
});
