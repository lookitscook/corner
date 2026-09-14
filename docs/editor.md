# Corner — Gradient Studio

A small browser-based editor for a black canvas with a configurable bottom-right corner gradient. The contour starts at the bottom edge, passes through two editable middle anchors, and ends at the right edge.

## Run

From the repository root, run `npm ci` and `npm run dev`. Build with `npm run build` and preview with `npm run preview`.

The inspector uses dat.gui 0.7.9, installed through npm and bundled locally by Vite. No CDN, Python, backend, or CMS is required. See the [project README](../README.md) for setup and verification commands.

## Editing

**A** is attached to the bottom edge and slides horizontally. **D** is attached to the right edge and slides vertically. Moving either endpoint stretches that axis of the contour, preserving the relative positions of the middle points on that axis.

**B** and **C** move in two dimensions. In the default **Through anchors** mode, all four points are on the curve. The implementation joins three cubic Bézier segments with continuous first derivatives. In **Cubic handles** mode, A and D are endpoints and B and C become the off-curve control handles of one conventional cubic Bézier. A dashed control polygon appears in this mode.

The middle anchors remain ordered between their neighbors. This intentionally prevents loops or folded contours, so the fade has a single unambiguous boundary in every direction from the corner. Coordinates in the inspector are percentages measured leftward and upward from the bottom-right corner.

Click the contour to select it and show its anchors. Click the empty canvas to deselect it. **Preview** hides all editing graphics. **Edit contour** restores them. Anchors have expanded hit targets for touch interaction.

## Controls

- **Gradient:** corner color, overall size, and falloff. Size uniformly scales the normalized contour about the bottom-right corner. Its percentage is the larger of the bottom and right reaches. A higher falloff concentrates the color closer to the corner; a lower value spreads it outward.
- **Contour:** starting shape, curve interpretation, bottom reach, and right reach. Presets include Sketch, Round, Wide, Tall, and Diagonal. Manual shape edits are labeled Custom.
- **Wave motion:** Animate toggles fluid motion. Amplitude (0–35%) sets deformation strength; Speed (0–1 Hz) sets the main wave frequency, with zero freezing the current pose. Wavelength (0.3–3 contour lengths) controls the spacing of the swell; Complexity (0–1) blends in smaller, overlapping ripples. Edge movement (0–1) controls how much A and D slide; zero pins both endpoints. Motion starts enabled unless the browser requests reduced motion. Disabling Animate restores the base contour.
- **Finish:** smooth or linear blending, and optional fine-grain or ordered 4 × 4 dithering. Dithering is limited to the gradient; it never adds noise to the black field or changes the exact corner color.
- **Middle anchors:** numeric controls for B and C, useful when the gradient is too small to drag individual points comfortably.
- **Canvas & export:** 4K UHD, 1080p, square, portrait, or custom dimensions. Width and height each accept 64–4096 pixels. The default output is 3840 × 2160.

## Export and persistence

**Export PNG** captures the currently displayed wave pose as a still image and renders the gradient at the selected output resolution, rather than enlarging a screenshot of the preview. It excludes the curve, points, labels, border, and all UI. The background is opaque black. Export uses a frozen copy of the settings, so changing the editor while an export runs does not change the in-progress output.

**Save setup** writes a small JSON file containing the base contour, wave parameters, and rendering settings (the playback phase is not saved). Older setups load with animation disabled. **Load setup** validates and restores that file. Unrecognized formats, invalid colors, invalid dimensions, non-finite coordinates, crossed anchors, and unanchored endpoints are rejected before the current setup is changed.

The most recent setup is also saved to browser local storage when available. Use Save setup for a portable copy across browsers or sites. This app makes no application-data uploads or external requests.

## Keyboard

| Key | Action |
| --- | --- |
| Tab | Focus a control or an anchor |
| Arrow keys | Move the selected anchor by one preview pixel |
| Shift + arrow | Move the selected anchor by ten preview pixels |
| Shift + drag | Fine movement at one-fifth speed |
| Space | Toggle clean preview when not editing a field or pressing a button |
| E | Show the editable contour |
| Escape | Deselect the contour |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |

Undo and redo retain up to 80 committed states. Reset is undoable.

## Rendering implementation

`src/engine.js` contains the geometry and Canvas 2D renderer. Anchors are normalized distances from the bottom-right corner. For the interpolating mode, shape-preserving Hermite derivatives are converted into cubic Bézier control points. The same segments are used for the SVG editing overlay and the color field.

Wave motion layers three traveling sine components with different speeds and wavelengths. Positive coordinate gaps are reweighted smoothly, keeping anchors ordered without abrupt clamping. The same animated points drive the overlay and gradient. Playback freezes during pointer drags; an inverse transform maps edits back to the base contour. Animation uses elapsed frame time, pauses in hidden tabs, and never writes transient poses into history or storage.

For each ray from the corner, the engine finds its intersection with the contour. Pixels fade from full color at the corner to zero at that intersection; everything outside is black. This is a contour-driven field, not a CSS radial-gradient approximation.

A 4096-interval radial lookup table accelerates the per-pixel work. Its direction coordinate is `sqrt(y) / (sqrt(x) + sqrt(y))`, which places more samples near the axes and improves accuracy around nearly tangential curve endpoints. An 8192-interval transfer table handles the blend profile and falloff. The preview is resolution-capped for responsiveness; PNG exports are evaluated directly at their requested resolution, in chunks that yield to the UI.

## Source files

`index.html` provides the Vite entry page. `src/styles.css` contains the responsive layout and dat.gui theme. `src/engine.js` exports geometry and rendering as an ES module. `src/main.js` imports the engine, stylesheet, and npm-installed dat.gui, and owns interaction, state/history, and exports.

## Verification

Run `npm test` from the repository root after installing Playwright Chromium (see the [project README](../README.md)). The engine suite checks randomized geometry and wave invariants. The JavaScript Playwright suite tests the production build with external requests blocked, exercising the real bundled dat.gui controls, editing, animation, setup validation, local storage, PNG export, and emulated mobile touch. Mobile checks use Chromium emulation, not a physical device or Safari.

## Dependency references

The only third-party runtime library is [dat.gui](https://github.com/dataarts/dat.gui), published by the Data Arts Team / Google Creative Lab under [Apache License 2.0](https://github.com/dataarts/dat.gui/blob/v0.7.9/LICENSE). npm installs it and Vite includes it in the production bundle.
