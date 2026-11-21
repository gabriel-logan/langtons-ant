# Langton's Ant

A [Langton's Ant](https://en.wikipedia.org/wiki/Langton%27s_ant) simulation written in **C**, compiled to **WebAssembly** with Emscripten and rendered with **WebGL2** inside a **Web Worker**.

The ant follows only the two classic rules. After roughly 10,000 steps of chaos, the *highway* (a 104-step pattern that repeats forever along a diagonal) **emerges on its own**, without any intervention. The app only detects and reports when it happens (around step 9,984).

## Getting started (step by step)

### 1. Prerequisites

You need:

- `git`
- `make`
- `python3` (used by the emsdk installer and the local web server)
- a native C compiler (`gcc` or `clang`), only for `make test`
- a modern browser with WebGL2 support (Chrome, Edge, Firefox or Safari 17+)

### 2. Clone this repository

```bash
git clone https://github.com/gabriel-logan/langtons-ant.git
cd langtons-ant
```

### 3. Clone and build Emscripten (emsdk) inside the project

This project does **not** use a system-wide Emscripten install. The SDK must live in `./emsdk`, at the repository root. The folder is already in `.gitignore`.

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
cd ..
```

`./emsdk install latest` downloads and sets up the toolchain (clang/LLVM, Node and Binaryen). It can take a few minutes.

Check that it worked:

```bash
./emsdk/upstream/emscripten/emcc --version
```

You don't need to run `source ./emsdk/emsdk_env.sh`: the Makefile calls the local `emcc` by its full path. If you want to use `emcc` directly in your shell, `source` only affects that terminal session and does not change your system.

### 4. Build the WebAssembly module

```bash
make
```

This generates `docs/wasm/langton.mjs` and `docs/wasm/langton.wasm`.

### 5. (Optional) Run the native C tests

```bash
make test
```

### 6. Serve and open in the browser

```bash
make serve
```

Then open <http://localhost:8080>. To use another port: `make serve PORT=3000`.

The page must be served over HTTP. Module workers and WebAssembly don't work when opening `index.html` straight from the file system (`file://`).

### Other commands

```bash
make clean   # removes build/ and docs/wasm/
```

## Controls

| Action | UI | Keyboard / mouse |
|---|---|---|
| Start / Stop | **Start**, **Stop** | `Space` |
| Restart | **Restart** | `R` |
| Speed (1/s → 1M/s → max) | logarithmic slider | `[` `]` |
| Step limit (default: **400,000**) | *Max steps* field | — |
| Zoom | **Zoom −** / **Zoom +** | `+` `−`, mouse wheel, pinch |
| Camera following the ant | **Follow ant** | `F` |
| Free camera | **Free** | drag, arrow keys |
| Show/hide panel | ☰ (mobile) | `H` |

Dragging the map switches the camera to free mode automatically.

## Architecture

```
src/
  langton.h / langton.c   simulation core (plain C11, no Emscripten)
  wasm_api.c              functions exported to JS (EMSCRIPTEN_KEEPALIVE)
tests/
  test_langton.c          native tests (rules, limits, growth, highway)
docs/
  index.html, css/style.css
  js/main.js              main thread: creates the worker, wires UI ↔ worker
  js/shared/protocol.js   message contract and constants
  js/ui/                  control panel, canvas input, formatting
  js/worker/
    sim-worker.js         simulation + rendering loop (off the UI thread)
    simulation.js         WASM module wrapper
    renderer.js           WebGL2 (shaders, grid texture, mipmaps)
    camera.js             free / follow-the-ant camera
```

The **main thread** only handles the UI. The canvas is transferred to the worker as an `OffscreenCanvas`, so **simulation and rendering run on the same worker thread**: the GPU reads the grid straight from WebAssembly memory, with no copies between threads.

**Simulation (C):**

- Dense grid with 1 byte per cell that **doubles in size** (256² → … → 8192²) whenever the ant would reach the edge. There is no wrap-around, so the simulation is exact.
- When the grid grows, the old content is placed so that the new space lies in the direction the ant is heading. Since the highway is diagonal, this almost doubles the reach for the same memory: about 428k steps on an 8192² grid.
- The hot loop only uses locals and tracks the rectangle of modified cells (*dirty rect*).
- 64-bit counters; the step limit is honored exactly.

**Rendering (WebGL2):**

- The grid is an `R8` texture. Each frame only the dirty rect is uploaded (`texSubImage2D` + `UNPACK_ROW_LENGTH`, straight from the heap).
- A single fullscreen triangle; the fragment shader maps each pixel to world coordinates.
- **Zoomed out:** mipmaps average the cells, so nothing flickers and the highway stays visible even with many cells per pixel.
- **Zoomed in:** grid lines and an SDF-drawn ant pointing in its current direction.
- **Low speeds:** the ant slides and rotates smoothly between cells.

**Worker loop:** uses `requestAnimationFrame` with a budget of about 10 ms of simulation per frame. At max speed it runs as much as fits without stalling rendering.
