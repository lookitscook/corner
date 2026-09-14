export const RENDER_STYLES = ['Smooth', 'Ordered dither'];
export const RENDER_DEFAULTS = Object.freeze({
  renderStyle: 'Smooth',
  orderedSpacing: 1.8, orderedDotSize: 65, orderedLevels: 8, orderedContrast: 1,
});
export const RENDER_RANGES = {
  orderedSpacing: [.5, 6, .1], orderedDotSize: [10, 100, 1],
  orderedLevels: [2, 16, 1], orderedContrast: [.25, 3, .05],
};

// Missing fields in older setups preserve the original smooth rendering.
export function readRenderSettings(settings) {
  const result = {};
  for (const [key, fallback] of Object.entries(RENDER_DEFAULTS)) {
    let value = settings[key] === undefined ? fallback : settings[key];
    if (key === 'renderStyle') {
      // Retired mesh setups keep their contour and color using smooth rendering.
      if (value === 'Mesh') value = 'Smooth';
      if (!RENDER_STYLES.includes(value)) throw new Error('Invalid rendering style.');
    } else {
      const [min, max] = RENDER_RANGES[key];
      if (!Number.isFinite(value) || value < min || value > max ||
        (key === 'orderedLevels' && !Number.isInteger(value))) {
        throw new Error(`Invalid ${key} setting.`);
      }
    }
    result[key] = value;
  }
  return result;
}
