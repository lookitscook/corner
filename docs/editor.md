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
- **Rendering:** choose Smooth or Ordered dither. Only parameters for the selected style are shown; switching styles retains their settings.
- **Contour:** starting shape, curve interpretation, bottom reach, and right reach. Presets include Sketch, Round, Wide, Tall, and Diagonal. Manual shape edits are labeled Custom.
- **Wave motion:** Animate toggles fluid motion. Amplitude (0–35%) sets deformation strength; Speed (0–1 Hz) sets the main wave frequency, with zero freezing the current pose. Wavelength (0.3–3 contour lengths) controls the spacing of the swell; Complexity (0–1) blends in smaller, overlapping ripples. Edge movement (0–1) controls how much A and D slide; zero pins both endpoints. Motion starts enabled unless the browser requests reduced motion. Disabling Animate restores the base contour.
- **Finish:** smooth or linear blending for all styles. Smooth rendering also offers subtle fine-grain or ordered 4 × 4 dithering to reduce banding. The larger square-dot Ordered dither style is selected in Rendering.
- **Middle anchors:** numeric controls for B and C, useful when the gradient is too small to drag individual points comfortably.
- **Canvas & export:** choose PNG, GIF, or APNG under **File type**. Canvas presets include 4K UHD, 1080p, square, portrait, and custom dimensions. Width and height each accept 64–4096 pixels. GIF and APNG expose loop duration, frame rate, and maximum export edge controls.

## Rendering styles

All styles use the editable contour, corner color, falloff, and wave animation. The area outside the contour stays opaque black, and the bottom-right pixel retains the exact selected color. Spacing is a percentage of the canvas's shorter side, so the pattern layout stays consistent across preview and PNG resolutions.

**Smooth** preserves the original continuous gradient.

**Ordered dither** draws a regular grid of square dots. A repeating Bayer threshold matrix distributes the available tones across neighboring dots.

- **Spacing % (0.5–6):** distance between dot centers, relative to the shorter canvas side.
- **Dot size % (10–100):** square width as a percentage of the spacing; smaller values leave wider black gaps.
- **Size fade % (0–100):** shrinks dots as the gradient darkens, in addition to fading their brightness. At 0, dots keep a fixed size (the default for existing setups). At 100, they progressively shrink toward zero at the dark edge; intermediate values soften the effect. Dot size still sets the maximum width near the bright corner, and spacing stays fixed.
- **Tone levels (2–16):** number of brightness levels, including black and the selected corner color. Two levels produce a binary pattern; higher values give a more gradual fade.
- **Contrast (0.25–3):** shapes dot brightness. Higher values darken the midtones; lower values spread brightness outward.

Pattern edges are antialiased at the render resolution. Very fine dots may look softer in the reduced-size preview than in a full-resolution export.

## Export and persistence

**Export PNG** captures the currently displayed wave pose as a still image and renders the gradient at the selected output resolution, rather than enlarging a screenshot of the preview. It excludes the curve, points, labels, border, and all UI. The background is opaque black. Export uses a frozen copy of the settings, so changing the editor while an export runs does not change the in-progress output.

To export an animation, open **Canvas & export**, select **GIF** or **APNG** as the file type, and click the top **Export GIF/APNG** button. Both formats repeat forever and include only the rendered gradient, with an opaque black background. Animated exports automatically crop away the unused black canvas above and to the left of the corner. One fixed crop contains the gradient's full extent across every frame, so the loop never shifts or clips as it moves. Cropping preserves the original pixels and dot spacing; PNG stills keep the full canvas.

- **Loop seconds:** 1–20 seconds, default 6.
- **Frame rate:** 10, 15, 20, 24, 25, or 30 frames per second, default 20.
- **Max edge px:** 128–1920 pixels, default 960. The canvas is scaled proportionally to fit this limit, then cropped; the resulting animation can have a different aspect ratio. It never enlarges the canvas. The filename and completion message show the final cropped dimensions. PNG output still uses the full canvas dimensions.

The loop starts at the current wave pose. Each wave component is fitted to a whole number of cycles within the chosen duration, keeping both the pose and motion continuous at the join. The endpoint frame is not duplicated. The exported motion can differ from live playback because its frequencies are adjusted to close the loop. Zero speed freezes the current pose; disabling Animate or setting amplitude to zero produces a static export.

GIF uses a fixed 256-color palette spanning black to the selected corner color. APNG preserves the renderer's exact pixel colors. Ordered dither and Size fade work in both formats. GIF frame delays are rounded to centiseconds while preserving the total loop duration.

Animated encoding runs locally in a worker and processes one frame at a time. The top button shows progress; **Cancel** stops the export. Preview playback pauses during export, and editing the setup does not change the file being generated. Jobs are limited to 240 million pixels across all frames and a 96 MB encoded file; lower the size, duration, or frame rate if a limit is reached.

**Save setup** writes a small JSON file containing the base contour, wave parameters, rendering style, pattern settings, and export options (the playback phase is not saved). Setups without export options default to PNG. Setups without rendering-style fields retain the original smooth appearance, and setups without wave fields load with animation disabled. **Load setup** validates and restores that file. Unrecognized formats, invalid colors or pattern parameters, invalid dimensions, non-finite coordinates, crossed anchors, and unanchored endpoints are rejected before the current setup is changed.

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

Ordered rendering samples the field once per dot and quantizes it with a 4 × 4 Bayer threshold matrix. Pixel-footprint filtering softens subpixel dot edges. The pattern is anchored at the bottom-right corner; its fade follows the animated contour. Preview and chunked exports use the same renderer and frozen settings.

## Source files

`index.html` provides the Vite entry page. `src/styles.css` contains the responsive layout and dat.gui theme. `src/engine.js` exports geometry and rendering as an ES module. `src/render-settings.js` defines rendering defaults, parameter ranges, and setup validation. `src/main.js` imports the engine, stylesheet, and npm-installed dat.gui, and owns interaction, state/history, and exports.

## Verification

Run `npm test` from the repository root after installing Playwright Chromium (see the [project README](../README.md)). The engine suite checks randomized geometry and wave invariants. The JavaScript Playwright suite tests the production build with external requests blocked, exercising the real bundled dat.gui controls, editing, animation, setup validation, local storage, PNG export, and emulated mobile touch. Mobile checks use Chromium emulation, not a physical device or Safari.

## Dependency references

The inspector uses [dat.gui](https://github.com/dataarts/dat.gui), published by the Data Arts Team / Google Creative Lab under [Apache License 2.0](https://github.com/dataarts/dat.gui/blob/v0.7.9/LICENSE). GIF encoding uses [gifenc](https://github.com/mattdesl/gifenc), and APNG compression uses [fflate](https://github.com/101arrowz/fflate), both under the MIT license. npm installs these libraries, Vite bundles them locally, and their license files are included in `public/`. Animated export requires a browser with module workers and OffscreenCanvas support.
