import { Defaults } from '../shared/protocol.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Center in world cells, zoom in CSS pixels per cell. */
export class Camera {
  constructor() {
    this.x = 0.5;
    this.y = 0.5;
    this.zoom = Defaults.ZOOM;
    this.follow = true;
    this.viewWidth = 1;
    this.viewHeight = 1;
  }

  setViewport(width, height) {
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.zoom = Defaults.ZOOM;
  }

  pan(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Zooms keeping the world point under (sx, sy) fixed; in follow mode, around the ant. */
  zoomAt(factor, sx = this.viewWidth / 2, sy = this.viewHeight / 2) {
    const next = clamp(this.zoom * factor, Defaults.MIN_ZOOM, Defaults.MAX_ZOOM);

    if (this.follow) {
      this.zoom = next;
      return;
    }

    const ox = sx - this.viewWidth / 2;
    const oy = sy - this.viewHeight / 2;
    const wx = this.x + ox / this.zoom;
    const wy = this.y + oy / this.zoom;

    this.zoom = next;
    this.x = wx - ox / next;
    this.y = wy - oy / next;
  }

  /** Frame-rate independent smoothing towards the target. Returns true if the camera moved. */
  update(dt, targetX, targetY) {
    if (!this.follow) {
      return false;
    }

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const farX = Math.abs(dx) * this.zoom > this.viewWidth * 2;
    const farY = Math.abs(dy) * this.zoom > this.viewHeight * 2;

    if (farX || farY) {
      this.x = targetX;
      this.y = targetY;
      return true;
    }

    const k = 1 - Math.exp(-dt * 10);
    this.x += dx * k;
    this.y += dy * k;

    // Smoothing lags proportionally to speed; never let the ant drift off-center too far.
    const maxLag = (Math.min(this.viewWidth, this.viewHeight) * 0.25) / this.zoom;
    this.x = clamp(this.x, targetX - maxLag, targetX + maxLag);
    this.y = clamp(this.y, targetY - maxLag, targetY + maxLag);

    return Math.abs(dx * this.zoom) > 0.01 || Math.abs(dy * this.zoom) > 0.01;
  }
}
