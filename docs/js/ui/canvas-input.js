/**
 * Mouse/touch drag, pinch and wheel on the canvas, translated into camera commands.
 * camera: { pan(dx, dy), zoom(factor, x, y) } in CSS pixels.
 */
export function attachCanvasInput(canvas, camera) {
  const pointers = new Map();
  let pinchDist = 0;

  function local(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function release(event) {
    pointers.delete(event.pointerId);

    if (pointers.size < 2) {
      pinchDist = 0;
    }
    if (pointers.size === 0) {
      canvas.classList.remove('is-dragging');
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, local(event));
    canvas.classList.add('is-dragging');

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone (e.g. synthetic events).
    }

    if (pointers.size === 2) {
      pinchDist = pinchState().dist;
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    const prev = pointers.get(event.pointerId);
    if (!prev) {
      return;
    }

    const cur = local(event);

    if (pointers.size === 1) {
      camera.pan(cur.x - prev.x, cur.y - prev.y);
      pointers.set(event.pointerId, cur);
      return;
    }

    if (pointers.size === 2) {
      const before = pinchState();
      pointers.set(event.pointerId, cur);
      const after = pinchState();

      camera.pan(after.mid.x - before.mid.x, after.mid.y - before.mid.y);
      if (pinchDist > 0 && after.dist > 0) {
        camera.zoom(after.dist / pinchDist, after.mid.x, after.mid.y);
      }
      pinchDist = after.dist;
    }
  });

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();

    // Normalize line/page deltas to pixels.
    let scale = 1;
    if (event.deltaMode === 1) {
      scale = 16;
    } else if (event.deltaMode === 2) {
      scale = 400;
    }

    const p = local(event);
    camera.zoom(Math.exp(-event.deltaY * scale * 0.0015), p.x, p.y);
  }, { passive: false });

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}
