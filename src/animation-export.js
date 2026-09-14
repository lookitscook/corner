import { animationPlan } from './export-settings.js';

export function startAnimationExport(snapshot, onProgress) {
  const plan = animationPlan(snapshot.settings);
  const worker = new Worker(new URL('./animation-worker.js', import.meta.url), { type: 'module' });
  let rejectExport;
  const promise = new Promise((resolve, reject) => {
    rejectExport = reject;
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.progress);
      else if (data.type === 'done') {
        worker.terminate();
        resolve({ blob: new Blob([data.buffer], { type: plan.format === 'GIF' ? 'image/gif' : 'image/apng' }),
          plan: { ...plan, width: data.width, height: data.height } });
      } else if (data.type === 'error') {
        worker.terminate(); reject(new Error(data.message));
      }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('Animated export failed. Try a smaller size or a current browser.')); };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('Could not read the exported animation.')); };
    worker.postMessage(snapshot);
  });
  return { promise, cancel() { worker.terminate(); rejectExport(new DOMException('Export cancelled.', 'AbortError')); } };
}
