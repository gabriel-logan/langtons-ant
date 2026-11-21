/*
 * The whole grid lives in an R8 texture (same layout as the WASM memory).
 * Each frame only the dirty rectangle is uploaded. A single fullscreen
 * triangle maps every pixel to world space; mipmaps handle zoomed-out views.
 */

const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uGrid;
uniform vec2 uRes;
uniform vec2 uCam;
uniform float uZoom;        // device pixels per cell
uniform vec2 uGridOrigin;
uniform float uGridSize;
uniform vec2 uAnt;          // top-left corner of the ant cell, world space
uniform float uAntAngle;    // 0 = north, clockwise
uniform float uDpr;
uniform float uTime;

out vec4 outColor;

const vec3 C_EMPTY = vec3(0.047, 0.066, 0.106);
const vec3 C_FILLED = vec3(0.957, 0.812, 0.478);
const vec3 C_ANT = vec3(1.000, 0.310, 0.430);

float sdCircle(vec2 p, vec2 c, float r) {
  return length(p - c) - r;
}

float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Ant silhouette in cell-local space: centered at 0, facing -y.
float sdAnt(vec2 p) {
  float d = sdCircle(p, vec2(0.0, -0.27), 0.12);
  d = min(d, sdCircle(p, vec2(0.0, -0.06), 0.10));
  d = min(d, sdCircle(p, vec2(0.0, 0.21), 0.18));

  vec2 m = vec2(abs(p.x), p.y);
  for (int i = -1; i <= 1; i++) {
    float y = -0.06 + float(i) * 0.09;
    vec2 a = vec2(0.06, y);
    vec2 b = vec2(0.36, y + float(i) * 0.12 + 0.03);
    d = min(d, sdSegment(m, a, b, 0.025));
  }
  return d;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 world = uCam + (px - 0.5 * uRes) / uZoom;

  vec2 g = world - uGridOrigin;
  vec2 uv = g / uGridSize;
  // Derivatives must be taken outside the branch (uniform control flow).
  vec2 ddx = dFdx(uv);
  vec2 ddy = dFdy(uv);
  float v = 0.0;
  if (all(greaterThanEqual(g, vec2(0.0))) && all(lessThan(g, vec2(uGridSize)))) {
    v = textureGrad(uGrid, uv, ddx, ddy).r;
  }
  // Boost low densities so the highway stays visible when zoomed out.
  v = pow(v, 0.6);
  vec3 col = mix(C_EMPTY, C_FILLED, v);

  float gridA = smoothstep(5.0, 16.0, uZoom);
  if (gridA > 0.0) {
    vec2 f = fract(world);
    vec2 d = min(f, 1.0 - f) * uZoom;
    float line = 1.0 - smoothstep(0.0, uDpr, min(d.x, d.y));
    col = mix(col, col * 0.55 + 0.06, line * gridA);
  }

  vec2 q = world - (uAnt + 0.5);
  float distPx = length(q) * uZoom;

  float pulse = 0.85 + 0.15 * sin(uTime * 4.0);
  float glowR = max(14.0 * uDpr, uZoom * 1.2);
  col += C_ANT * 0.35 * pulse * exp(-(distPx * distPx) / (glowR * glowR));

  float bodyA = smoothstep(5.0, 10.0, uZoom);
  if (bodyA > 0.0) {
    float c = cos(uAntAngle);
    float s = sin(uAntAngle);
    vec2 lp = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
    float d = sdAnt(lp) * uZoom;
    float a = 1.0 - smoothstep(-0.75, 0.75, d);
    col = mix(col, C_ANT, a * bodyA);
  }

  // Dot + ring marker when the ant is too small to see.
  float markA = 1.0 - bodyA;
  if (markA > 0.0) {
    float dotR = max(2.5 * uDpr, uZoom * 0.5);
    float ringR = 9.0 * uDpr + 2.0 * uDpr * sin(uTime * 4.0);
    float dotA = 1.0 - smoothstep(dotR - uDpr, dotR, distPx);
    float ringA = 1.0 - smoothstep(0.0, 1.2 * uDpr, abs(distPx - ringR) - 0.6 * uDpr);
    col = mix(col, C_ANT, max(dotA, ringA * 0.9) * markA);
  }

  vec2 sv = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.35 * dot(sv, sv);

  outColor = vec4(col, 1.0);
}`;

const UNIFORMS = [
  'uGrid', 'uRes', 'uCam', 'uZoom', 'uGridOrigin', 'uGridSize',
  'uAnt', 'uAntAngle', 'uDpr', 'uTime',
];

const MIPMAP_INTERVAL_MS = 50;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

function link(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link error:\n${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export class Renderer {
  /** @param {OffscreenCanvas} canvas */
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      throw new Error('WebGL2 is not available in this browser.');
    }

    this.canvas = canvas;
    this.gl = gl;
    this.program = link(gl, VERT, FRAG);
    this.vao = gl.createVertexArray();
    this.u = {};
    for (const name of UNIFORMS) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    this.texture = null;
    this.texSize = 0;
    this.generation = -1;
    this.originX = 0;
    this.originY = 0;
    this.mipsDirty = true;
    this.lastMipmapAt = 0;
    this.dpr = 1;

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  get maxTextureSize() {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
  }

  resize(width, height, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
  }

  #allocate(size) {
    const gl = this.gl;

    if (this.texture) {
      gl.deleteTexture(this.texture);
    }

    const texture = gl.createTexture();
    const levels = Math.floor(Math.log2(size)) + 1;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.R8, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.texture = texture;
    this.texSize = size;
  }

  /** Uploads cells changed since the last sync. Returns true if anything was uploaded. */
  sync(sim) {
    const gl = this.gl;
    const grid = sim.grid;
    let rect = grid.dirty;

    if (grid.generation !== this.generation) {
      this.#allocate(grid.size);
      this.generation = grid.generation;
      rect = { x0: 0, y0: 0, x1: grid.size - 1, y1: grid.size - 1 };
    }

    if (!rect) {
      return false;
    }

    const width = rect.x1 - rect.x0 + 1;
    const height = rect.y1 - rect.y0 + 1;
    const offset = rect.y0 * grid.size + rect.x0;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, grid.size);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x0, rect.y0, width, height,
      gl.RED, gl.UNSIGNED_BYTE, grid.cells, offset);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);

    sim.clearDirty();
    this.mipsDirty = true;
    this.originX = grid.originX;
    this.originY = grid.originY;
    return true;
  }

  draw(camera, ant, timeSeconds) {
    const gl = this.gl;
    const u = this.u;
    const zoom = camera.zoom * this.dpr;
    const nowMs = timeSeconds * 1000;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    // Mipmaps only matter when zoomed out; regenerate at a limited rate.
    const mipmapDue = nowMs - this.lastMipmapAt >= MIPMAP_INTERVAL_MS;
    if (zoom < 1 && this.mipsDirty && mipmapDue) {
      gl.generateMipmap(gl.TEXTURE_2D);
      this.mipsDirty = false;
      this.lastMipmapAt = nowMs;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform1i(u.uGrid, 0);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uCam, camera.x, camera.y);
    gl.uniform1f(u.uZoom, zoom);
    gl.uniform2f(u.uGridOrigin, this.originX, this.originY);
    gl.uniform1f(u.uGridSize, this.texSize);
    gl.uniform2f(u.uAnt, ant.x, ant.y);
    gl.uniform1f(u.uAntAngle, ant.angle);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1f(u.uTime, timeSeconds);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
