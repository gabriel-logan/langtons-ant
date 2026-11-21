# Learn: Langton's Ant, C, WebAssembly and WebGL2

This document explains both **the math behind Langton's Ant** and **how this project is built**, from the C core to the pixels on screen. Read it top to bottom, or jump to the part you care about.

- [Part 1 — Langton's Ant](#part-1--langtons-ant)
- [Part 2 — The simulation core in C](#part-2--the-simulation-core-in-c)
- [Part 3 — Compiling C to WebAssembly](#part-3--compiling-c-to-webassembly)
- [Part 4 — Threads: main thread vs. Web Worker](#part-4--threads-main-thread-vs-web-worker)
- [Part 5 — Rendering with WebGL2](#part-5--rendering-with-webgl2)
- [Part 6 — Camera and input](#part-6--camera-and-input)
- [Part 7 — Testing](#part-7--testing)
- [Part 8 — Exercises](#part-8--exercises)
- [Further reading](#further-reading)

---

## Part 1 — Langton's Ant

### The rules

Langton's Ant was introduced by Chris Langton in 1986. It is a *cellular automaton* with a single moving agent: an ant on an infinite grid of square cells, each one either **white** or **black**. All cells start white.

At every step the ant looks at the cell it is standing on:

1. On a **white** cell it turns **90° right**. On a **black** cell it turns **90° left**.
2. It **flips the color** of the cell.
3. It **moves forward** one cell.

That is the entire program. Because of the right/left pair, this rule is often written as **`RL`**.

### Three phases

Despite the tiny rule set, the ant goes through three very different behaviors:

| Phase | Steps (approx.) | What you see |
|---|---|---|
| Simplicity | first few hundred | small, often symmetric patterns |
| Chaos | up to ~10,000 | an irregular, pseudo-random blob |
| Emergent order | after ~10,000 | the **highway** |

### The highway

Around step 10,000 the ant falls into a cycle of **104 steps**. After each cycle the pattern is the same as before, just shifted **2 cells diagonally**. The ant then repeats this forever, building a straight diagonal "road" that never stops.

Nobody programs the highway in. It **emerges** from the two rules, which is why this project never intervenes in the simulation: it only *observes* and reports when the highway appears. In this implementation it is detected around **step 9,984**.

### What is proven and what isn't

- **Proven (Cohen–Kong theorem):** for any finite initial configuration, the ant's trajectory is *unbounded*. It can never stay trapped in a finite region forever.
- **Conjectured, not proven:** that the ant *always* ends up building a highway, whatever finite pattern of black cells it starts on. Every configuration tested so far does, but there is no proof.

### Generalizations

Replace the two colors with *n* colors and give each color a turn direction. A rule string like `RLR` or `LLRR` then means: color 0 turns R, color 1 turns L, and so on, and each visited cell advances to the next color. Many of these rules produce symmetric patterns, spirals or chaos that never settles. These generalized ants are known as *turmites*, and some of them are capable of universal computation.

This project implements the classic `RL` rule. Adding multi-color rules is one of the exercises in [Part 8](#part-8--exercises).

---

## Part 2 — The simulation core in C

Files: `src/langton.h`, `src/langton.c`.

The core is **plain C11 with no Emscripten dependency**. That lets the same code be compiled natively for tests (`make test`) and to WebAssembly for the browser.

### State

All simulation state lives in one struct, `LgSim`:

```c
typedef struct {
    uint8_t *cells;
    int32_t size;
    int32_t initial_size;
    int32_t max_size;
    int32_t origin_x;
    int32_t origin_y;
    uint32_t generation;

    int32_t x;
    int32_t y;
    uint8_t dir;

    uint64_t steps;
    uint64_t max_steps;
    uint64_t black_cells;
    LgStatus status;

    LgDirtyRect dirty;
    /* ... highway detection fields ... */
} LgSim;
```

### Two coordinate systems

- **World coordinates:** the infinite plane. The ant starts at world `(0, 0)`.
- **Grid coordinates:** indices into the `cells` array, from `0` to `size - 1`.

They are related by an offset:

```c
world_x = grid_x + origin_x;
world_y = grid_y + origin_y;
```

Keeping them separate is what allows the grid to grow without the ant "teleporting": when the grid is reallocated, only `origin_x`, `origin_y` and the grid-space position change. The world position stays the same.

### Directions as integers

Directions are numbered clockwise: `0 = North`, `1 = East`, `2 = South`, `3 = West`. With that encoding:

- turning **right** is `(dir + 1) & 3`
- turning **left** is `(dir + 3) & 3` (adding 3 is the same as subtracting 1, modulo 4)

Movement uses two lookup tables. The Y axis points down to match screen coordinates:

```c
static const int8_t DX[4] = { 0, 1, 0, -1 };
static const int8_t DY[4] = { -1, 0, 1, 0 };
```

### Why black cells are `0xFF` and not `1`

The cell buffer is uploaded to the GPU as-is (see [Part 5](#part-5--rendering-with-webgl2)). In a normalized 8-bit texture, the byte `1` reads as `1 / 255 ≈ 0.004`, which is almost invisible. Storing `0xFF` makes a black cell read as exactly `1.0`. It also keeps full precision when the GPU averages cells into mipmaps. Flipping a cell is still a single XOR:

```c
cells[idx] = (uint8_t)(cell ^ LG_CELL_ON);
```

### The hot loop

`lg_step(s, n)` runs up to `n` steps. Its inner loop is the most performance-critical code in the project, so it copies every field it needs into **local variables** first. The compiler can then keep them in registers instead of reading and writing memory through the `s` pointer on every step:

```c
uint8_t *cells = s->cells;
int32_t size = s->size;
int32_t x = s->x;
int32_t y = s->y;
uint32_t dir = s->dir;
```

The locals are written back (`SYNC_OUT()`) only when needed: at the end, before growing the grid, and every 104 steps for highway detection. Even compiled to WebAssembly, this runs millions of steps per second.

### A grid that grows

The plane is infinite, but memory is not. The grid starts at 256 × 256 and **doubles** whenever the ant's next position would fall outside it. The order is important:

1. Compute the next direction and position.
2. If that position is out of bounds, grow the grid **before** executing the step.
3. If growing fails (the maximum size was reached), return without executing the step.

Because of this ordering, the state is always consistent: a step is either fully executed or not executed at all. There is **no wrap-around**, so the simulation is exact.

**Smart placement.** When the grid doubles, the old content could simply go in the center. Instead, `grow_offset()` places it so that the new empty space lies **in the direction the ant is heading**:

```c
static int32_t grow_offset(int32_t next, int32_t current, int32_t old_size, int32_t extra) {
    if (next >= old_size) {
        return 0;
    }
    if (next < 0) {
        return extra;
    }
    if (current >= old_size / 2) {
        return 0;
    }
    return extra;
}
```

The highway is diagonal, so this almost doubles how far the ant can travel for the same memory: an 8192 × 8192 grid (64 MB) holds about **428,000 steps**. That is why the default step limit is 400,000.

### The dirty rectangle

Re-uploading a 64 MB grid to the GPU every frame would be far too slow. Instead, the loop tracks the bounding box of every cell it modified, called the **dirty rectangle**:

```c
if (x < dx0) {
    dx0 = x;
}
if (x > dx1) {
    dx1 = x;
}
```

The renderer uploads only that rectangle and then calls `lg_clear_dirty()`. At normal speeds it is just a few cells per frame.

### Detecting the highway

Detection is purely observational. Every 104 steps, `highway_checkpoint()` compares the ant's world position with its position 104 steps earlier. In the periodic regime the displacement is always `(±2, ±2)`. After 12 consecutive confirmations, the highway is considered to have started at the first step of that streak:

```c
if ((dx == 2 || dx == -2) && (dy == 2 || dy == -2)) {
    s->hw_streak++;
} else {
    s->hw_streak = 0;
}
```

A periodic motion has the same displacement over *any* window of one period, so it does not matter where the 104-step windows happen to start.

---

## Part 3 — Compiling C to WebAssembly

Files: `src/wasm_api.c`, `Makefile`.

### The exported API

`wasm_api.c` keeps a single global `LgSim` and exposes small functions that take and return plain numbers:

```c
EMSCRIPTEN_KEEPALIVE int ant_step(unsigned n) {
    return (int)lg_step(&g_sim, n);
}
```

`EMSCRIPTEN_KEEPALIVE` stops the linker from removing a function that no C code calls, and exports it to JavaScript as `Module._ant_step`.

**64-bit numbers.** JavaScript numbers are doubles, which can represent every integer exactly up to 2^53. The 64-bit counters (`steps`, `max_steps`, `black_cells`) are therefore converted to `double` at the boundary:

```c
EMSCRIPTEN_KEEPALIVE double ant_steps(void) {
    return (double)g_sim.steps;
}
```

### Build flags

| Flag | Why |
|---|---|
| `-O3` | Full optimization. |
| `-sMODULARIZE=1 -sEXPORT_ES6=1` | Output an ES module with a factory function instead of global variables. |
| `-sEXPORT_NAME=createLangtonModule` | The name of that factory. |
| `-sENVIRONMENT=worker` | The module only ever runs inside a Web Worker, so the Node and browser-window code paths are dropped. |
| `-sFILESYSTEM=0` | No virtual file system is needed, so the output is smaller. |
| `-sALLOW_MEMORY_GROWTH=1` | `calloc` can grow WASM memory when the grid doubles. |
| `-sINITIAL_MEMORY=16mb -sMAXIMUM_MEMORY=512mb` | Start small, with a safe upper bound. |
| `-sEXPORTED_RUNTIME_METHODS=HEAPU8` | Gives JavaScript a byte view of WASM memory, used to read the grid without copying it. |

The output is `docs/wasm/langton.mjs` (the JavaScript loader) and `docs/wasm/langton.wasm` (the compiled code).

### Reading WASM memory without copies

A C pointer is just an offset into the WASM linear memory. `simulation.js` turns the grid pointer into a typed-array view over that memory:

```js
new Uint8Array(m.HEAPU8.buffer, m._grid_ptr(), size * size);
```

**The detached-buffer pitfall:** when WASM memory grows, the old `ArrayBuffer` is replaced by a new one, and any view created over the old buffer becomes unusable. That is why the `grid` getter creates a fresh view on every call instead of caching one.

---

## Part 4 — Threads: main thread vs. Web Worker

Files: `docs/js/main.js`, `docs/js/worker/sim-worker.js`, `docs/js/shared/protocol.js`.

### Why a worker

JavaScript on a page runs on one main thread, which also handles clicks, scrolling and layout. A simulation running millions of steps per second there would freeze the interface. Here, the heavy work runs in a **Web Worker**, and the main thread only handles the UI.

### OffscreenCanvas: render where the data lives

The obvious design would be "simulate in the worker, render on the main thread". That would require copying the grid between threads, possibly megabytes per frame. Instead, the main thread hands the canvas itself to the worker:

```js
const offscreen = canvas.transferControlToOffscreen();
send(Cmd.INIT, { canvas: offscreen }, [offscreen]);
```

From then on, the worker owns both the WASM memory and the WebGL context. The GPU reads the grid directly from WASM memory, and nothing is ever copied between threads.

### The message protocol

The two threads communicate only through `postMessage`. Every message type is declared in `protocol.js`:

- `Cmd`: main thread → worker (`START`, `STOP`, `ZOOM`, `PAN`, …)
- `Evt`: worker → main thread (`READY`, `STATS`, `ERROR`)

The worker sends a `STATS` snapshot about 10 times per second, and also immediately after any state change. The panel renders whatever it receives, so the UI never holds simulation state of its own.

Commands that arrive while the WASM module is still loading are queued and replayed once it is ready.

### The frame loop and its time budget

Each frame, the worker:

1. Works out how many steps to run: `stepsPerSecond × elapsed time`. The fractional remainder is carried to the next frame in an accumulator.
2. Runs them in chunks of 32,768, checking the clock between chunks, with a **10 ms budget**.
3. If the budget runs out, it **drops** the leftover steps instead of piling them onto the next frame. Otherwise one slow frame would make the next one slower, which in turn makes the one after slower, and so on (a "spiral of death").
4. Uploads the dirty rectangle, draws, and occasionally publishes stats.

At "max" speed, step 1 asks for as many steps as possible, and step 2 caps that at whatever fits in the budget.

### Smooth motion at low speed

At 30 steps per second or fewer, jumping from cell to cell looks choppy. The worker therefore remembers the previous position and angle and interpolates between them with a smoothstep curve, `t * t * (3 - 2 * t)`, so the ant glides and rotates.

The angle is kept **continuous**: going from West (270°) to North (0°) should be a 90° turn, not a 270° spin backwards. `#updateAngle()` always picks the shortest rotation.

---

## Part 5 — Rendering with WebGL2

File: `docs/js/worker/renderer.js`.

### The grid is a texture

The whole grid is a single **`R8` texture**: one 8-bit channel, the exact same layout as the C buffer. Uploading a dirty rectangle reads straight from WASM memory:

```js
gl.pixelStorei(gl.UNPACK_ROW_LENGTH, grid.size);
gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x0, rect.y0, width, height,
  gl.RED, gl.UNSIGNED_BYTE, grid.cells, offset);
```

`UNPACK_ROW_LENGTH` tells WebGL that the source rows are `grid.size` bytes long, even though only `width` bytes of each row are uploaded. Without it, the sub-rectangle would first have to be copied into a separate tightly packed buffer.

When the grid doubles, `generation` changes, and the texture is reallocated with `texStorage2D` and fully re-uploaded.

### One triangle, every pixel

There is no geometry: the vertex shader produces a single triangle that covers the whole screen, computing its corners from `gl_VertexID`. All the work happens in the fragment shader, which runs once per pixel:

```glsl
vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
vec2 world = uCam + (px - 0.5 * uRes) / uZoom;
```

That converts a pixel into a world position. From there, the shader samples the texture, then adds grid lines, the ant and a vignette.

### Zooming out: mipmaps

When zoomed far out, a single pixel can cover dozens of cells. Sampling just one of them makes the image flicker and the thin highway disappear. **Mipmaps** fix this: each mip level is the previous level shrunk by half, with every texel the average of four. The GPU picks the level matching the zoom, so each pixel shows the *average* of the cells it covers.

Two details:

- Mipmaps are regenerated only when they're needed (zoom below 1 pixel per cell) and at most every 50 ms, because regenerating them for a 64 MB texture is expensive.
- The averaged value is boosted with `pow(v, 0.6)`, so sparse structures like the highway stay visible instead of fading to near-black.

### Zooming in: grid lines and an SDF ant

When cells are large, the shader draws grid lines by measuring how close the pixel is to a cell border, using `fract(world)`. The lines fade in smoothly as the zoom increases.

The ant is drawn with a **signed distance function (SDF)**: a function that returns, for any point, the distance to the shape's edge (negative inside). The ant is made of three circles (head, thorax, abdomen) plus six line segments for the legs:

```glsl
float d = sdCircle(p, vec2(0.0, -0.27), 0.12);
d = min(d, sdCircle(p, vec2(0.0, -0.06), 0.10));
d = min(d, sdCircle(p, vec2(0.0, 0.21), 0.18));
```

`min` of two SDFs is their union. Converting the distance to pixels and passing it through `smoothstep` gives anti-aliased edges at any zoom. The point is rotated by the ant's angle before evaluating the SDF, which is how the ant faces its direction.

When the ant is too small to see, the shader instead draws a pulsing dot and ring around it, plus a soft glow.

### A subtle GLSL rule: derivatives and branches

The shader calls `dFdx` and `dFdy` (screen-space derivatives used to pick the mip level) **before** the `if` that checks whether the pixel is inside the grid:

```glsl
vec2 ddx = dFdx(uv);
vec2 ddy = dFdy(uv);
float v = 0.0;
if (insideGrid) {
    v = textureGrad(uGrid, uv, ddx, ddy).r;
}
```

GPUs compute derivatives by comparing neighboring pixels. Inside a branch that neighboring pixels may not take, the result is undefined. Computing them in uniform control flow and passing them explicitly to `textureGrad` avoids that.

---

## Part 6 — Camera and input

Files: `docs/js/worker/camera.js`, `docs/js/ui/canvas-input.js`.

The camera is just a center `(x, y)` in world cells plus a `zoom` in CSS pixels per cell.

**Zoom toward the cursor.** To zoom without the point under the mouse sliding away, the camera finds the world point under the cursor, changes the zoom, then moves the center so that same world point lands back under the cursor.

**Follow mode.** The camera eases toward the ant using exponential smoothing that does not depend on the frame rate:

```js
const k = 1 - Math.exp(-dt * 10);
```

Smoothing like this always lags behind a moving target, and the lag grows with speed. At high speeds the ant would leave the screen, so the camera is also clamped to stay within 25% of the viewport from the ant.

**Input.** Pointer events handle mouse and touch drag, a two-finger pinch zoom, and the mouse wheel. Many drag events can fire within a single frame, so the main thread adds them up and sends one `PAN` message per animation frame. Dragging switches the camera to free mode automatically.

---

## Part 7 — Testing

File: `tests/test_langton.c`. Run with:

```bash
make test
```

Because the core has no Emscripten dependency, it is tested natively with `gcc`/`clang`, and runs in milliseconds:

| Test | What it proves |
|---|---|
| first steps | The rules are implemented correctly: four white cells form a square and the ant returns to the origin. |
| step limit | The simulation stops exactly at `max_steps` and resumes when the limit is raised. |
| grid growth is exact | A grid that starts at 8 × 8 and grows produces a **cell-by-cell identical** result to one that was large from the start. |
| highway emerges | The highway is detected between steps 9,000 and 11,000, and one 104-step period moves the ant by `(±2, ±2)`. |
| grid limit | At 8192 × 8192 the simulation stops cleanly, with a consistent black cell count. |

The growth test is the important one: it is what guarantees that growing the grid never corrupts or loses a cell.

---

## Part 8 — Exercises

Ideas for extending the project, roughly ordered by difficulty:

1. **Change the starting direction.** Start the ant facing East instead of North. The highway still emerges; in which direction does it go now?
2. **Show a highway marker.** Draw something on screen at the step where the highway was detected.
3. **Random initial noise.** Fill a small square around the origin with random black cells before starting. Does the highway still appear? After how many steps?
4. **Multi-color rules.** Support rule strings like `RLR` or `LLRR`. Cells store a color index instead of on/off, and the shader maps each index to a color from a palette uniform. Remember why black is `0xFF` today: mipmaps average raw byte values, so think about how averaging color indices should work.
5. **Multiple ants.** Several ants on the same grid. Decide what happens when two ants step on the same cell in the same step.
6. **Bit-packed grid.** Store 8 cells per byte to fit 8× more steps in the same memory. This requires decoding the bits in the shader with an integer texture (`R8UI` with `usampler2D`). Integer textures cannot be mipmapped, so zoomed-out rendering needs a different solution.

---

## Further reading

- [Langton's ant on Wikipedia](https://en.wikipedia.org/wiki/Langton%27s_ant)
- [Turmite on Wikipedia](https://en.wikipedia.org/wiki/Turmite), the multi-color generalization
- [Emscripten documentation](https://emscripten.org/docs/)
- [OffscreenCanvas on MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [WebGL2 Fundamentals](https://webgl2fundamentals.org/)
- [Inigo Quilez on 2D distance functions](https://iquilezles.org/articles/distfunctions2d/)
