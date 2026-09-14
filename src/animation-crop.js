import E from './engine.js';

// Union the renderer's corner bounds across every exported pose. Ordered
// contours stay inside their endpoint extents, in both curve modes.
export function animationCrop(plan, points, settings, phase) {
  let x = plan.width - 2, y = plan.height - 2;
  for (let frame = 0; frame < plan.frames; frame++) {
    const pose = E.loopPoints(points, settings, frame / plan.frames, plan.seconds, phase);
    x = Math.min(x, Math.floor((1 - pose[0].x) * (plan.width - 1)));
    y = Math.min(y, Math.floor((1 - pose[3].y) * (plan.height - 1)));
  }
  x = Math.max(0, x); y = Math.max(0, y);
  return { x, y, width: plan.width - x, height: plan.height - y };
}
