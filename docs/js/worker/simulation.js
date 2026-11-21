import createLangtonModule from '../../wasm/langton.mjs';

/** Thin wrapper around the WebAssembly module (src/wasm_api.c). */
export class Simulation {
  constructor(mod) {
    this.m = mod;
  }

  static async create(maxGridSize, maxSteps) {
    const mod = await createLangtonModule();

    if (!mod._ant_init(maxGridSize, maxSteps)) {
      throw new Error('Failed to allocate the initial grid.');
    }
    return new Simulation(mod);
  }

  step(n) {
    return this.m._ant_step(n >>> 0);
  }

  reset() {
    return this.m._ant_reset() !== 0;
  }

  setMaxSteps(n) {
    this.m._ant_set_max_steps(n);
  }

  clearDirty() {
    this.m._ant_clear_dirty();
  }

  get x() {
    return this.m._ant_x();
  }

  get y() {
    return this.m._ant_y();
  }

  get dir() {
    return this.m._ant_dir();
  }

  get steps() {
    return this.m._ant_steps();
  }

  get maxSteps() {
    return this.m._ant_max_steps();
  }

  get blackCells() {
    return this.m._ant_black_cells();
  }

  get status() {
    return this.m._ant_status();
  }

  get highwayStep() {
    return this.m._ant_highway_step();
  }

  /**
   * Zero-copy view of the grid plus the region changed since clearDirty().
   * The view must be recreated on every call: growing WASM memory replaces the buffer.
   */
  get grid() {
    const m = this.m;
    const size = m._grid_size();
    let dirty = null;

    if (!m._dirty_empty()) {
      dirty = {
        x0: m._dirty_x0(),
        y0: m._dirty_y0(),
        x1: m._dirty_x1(),
        y1: m._dirty_y1(),
      };
    }

    return {
      cells: new Uint8Array(m.HEAPU8.buffer, m._grid_ptr(), size * size),
      size,
      originX: m._grid_origin_x(),
      originY: m._grid_origin_y(),
      generation: m._grid_generation(),
      dirty,
    };
  }
}
