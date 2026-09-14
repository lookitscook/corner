export const EXPORT_FORMATS = ['PNG', 'GIF', 'APNG'];
export const LOOP_FPS = [10, 15, 20, 24, 25, 30];
export const EXPORT_DEFAULTS = Object.freeze({ exportFormat: 'PNG', loopDuration: 6, loopFPS: 20, loopMaxEdge: 960 });
export const EXPORT_RANGES = { loopDuration: [1, 20, 1], loopMaxEdge: [128, 1920, 1] };

export function readExportSettings(settings) {
  const result = {};
  for (const [key, fallback] of Object.entries(EXPORT_DEFAULTS)) {
    const value = settings[key] === undefined ? fallback : settings[key];
    const valid = key === 'exportFormat' ? EXPORT_FORMATS.includes(value)
      : key === 'loopFPS' ? LOOP_FPS.includes(value)
        : Number.isInteger(value) && value >= EXPORT_RANGES[key][0] && value <= EXPORT_RANGES[key][1];
    if (!valid) throw new Error(`Invalid ${key} setting.`);
    result[key] = value;
  }
  return result;
}

export function animationPlan(settings) {
  const { exportFormat, loopDuration, loopFPS, loopMaxEdge } = readExportSettings(settings);
  if (exportFormat === 'PNG') throw new Error('Choose GIF or APNG for an animated export.');
  if (![settings.width, settings.height].every(v => Number.isInteger(v) && v >= 64 && v <= 4096)) {
    throw new Error('Invalid animation dimensions.');
  }
  const scale = Math.min(1, loopMaxEdge / Math.max(settings.width, settings.height));
  const width = Math.max(2, Math.round(settings.width * scale));
  const height = Math.max(2, Math.round(settings.height * scale));
  const frames = loopDuration * loopFPS;
  if (width * height * frames > 240_000_000) {
    throw new Error('This animation is too large. Reduce Max edge, Loop seconds, or Frame rate.');
  }
  return { format: exportFormat, width, height, frames, fps: loopFPS, seconds: loopDuration };
}
