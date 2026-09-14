import E from './engine.js';
import { animationPlan, checkAnimationSize } from './export-settings.js';
import { createAnimationEncoder } from './animation-encoders.js';
import { animationCrop } from './animation-crop.js';

self.onmessage = ({ data: snapshot }) => {
  try {
    const { settings, points, phase } = snapshot;
    const plan = animationPlan(settings);
    const crop = settings.exportCropped ? animationCrop(plan, points, settings, phase)
      : { x: 0, y: 0, width: plan.width, height: plan.height };
    const outputPlan = { ...plan, width: crop.width, height: crop.height };
    checkAnimationSize(outputPlan);
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('Could not create the animation canvas.');
    const encoder = createAnimationEncoder(outputPlan, E.colorRGB(settings.color));
    for (let frame = 0; frame < plan.frames; frame++) {
      const pose = E.loopPoints(points, settings, frame / plan.frames, plan.seconds, phase);
      E.render(ctx, plan.width, plan.height, E.prepare(pose, settings));
      // Render in the original coordinates so cropping cannot rescale the
      // gradient, shift its dots, or change the grain pattern.
      encoder.addFrame(ctx.getImageData(crop.x, crop.y, crop.width, crop.height).data);
      self.postMessage({ type: 'progress', progress: (frame + 1) / plan.frames });
    }
    const bytes = encoder.finish();
    self.postMessage({ type: 'done', buffer: bytes.buffer, width: crop.width, height: crop.height }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'Could not encode the animation.' });
  }
};
