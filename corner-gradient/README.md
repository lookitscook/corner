# Corner — Gradient Studio

A small browser-based editor for a black canvas with a configurable bottom-right corner gradient. The contour starts at the bottom edge, passes through two editable middle anchors, and ends at the right edge.

## Run

Open `corner-gradient.html` in a browser. It is the single-file build and needs no installation or build step. The split source version is `index.html` with `styles.css`, `engine.js`, `fallback-gui.js`, and `app.js`; those files can also be placed on any static web host.

The normal inspector uses **actual dat.gui 0.7.9**, loaded from a pinned jsDelivr URL, with unpkg as the second source. If those sources are blocked or the browser is offline, a separately implemented native-input inspector remains available and is explicitly labeled **native controls**. The editor, dragging, PNG output, and JSON import/export do not depend on the CDN being available. The fallback is not presented as dat.gui.

Opening an HTML attachment inside a document previewer may show the source or a static preview rather than execute it. Open it in a browser to use the editor. On a phone, serving the source folder from a static website is generally more convenient than opening a local HTML attachment.

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

The most recent setup is also saved to browser local storage when available. Local-file storage behavior depends on the browser; use Save setup for a portable copy. This app makes no application-data uploads. Its only external requests are for the dat.gui script.

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

`engine.js` contains the standalone geometry and Canvas 2D renderer. Anchors are normalized distances from the bottom-right corner. For the interpolating mode, shape-preserving Hermite derivatives are converted into cubic Bézier control points. The same segments are used for the SVG editing overlay and the color field.

Wave motion layers three traveling sine components with different speeds and wavelengths. Positive coordinate gaps are reweighted smoothly, keeping anchors ordered without abrupt clamping. The same animated points drive the overlay and gradient. Playback freezes during pointer drags; an inverse transform maps edits back to the base contour. Animation uses elapsed frame time, pauses in hidden tabs, and never writes transient poses into history or storage.

For each ray from the corner, the engine finds its intersection with the contour. Pixels fade from full color at the corner to zero at that intersection; everything outside is black. This is a contour-driven field, not a CSS radial-gradient approximation.

A 4096-interval radial lookup table accelerates the per-pixel work. Its direction coordinate is `sqrt(y) / (sqrt(x) + sqrt(y))`, which places more samples near the axes and improves accuracy around nearly tangential curve endpoints. An 8192-interval transfer table handles the blend profile and falloff. The preview is resolution-capped for responsiveness; PNG exports are evaluated directly at their requested resolution, in chunks that yield to the UI.

## Source files

`index.html` provides the page structure. `styles.css` contains the responsive layout and dat.gui theme. `engine.js` implements geometry and rendering. `app.js` owns interaction, dat.gui setup, state/history, and exports. `fallback-gui.js` provides the explicitly labeled offline controls. `build_standalone.py` inlines the first-party assets into one HTML file.

Rebuild the standalone file with:

```sh
python build_standalone.py
```

The result is written to `../corner-gradient.html` relative to this source folder.

## Verification

```sh
node tests/engine.test.js
python tests/browser.test.py
```

The browser tests need Playwright and Pillow. Set the `CHROMIUM` environment variable to a Chromium executable if it is not at `/usr/bin/chromium`. They inject the standalone HTML directly and intentionally block external requests to test the native fallback path.

Verified here: 320 randomized geometry cases, 160 wave cases covering ordering, bounds, continuity, inverse editing, and base-shape preservation, interpolation at all four anchors, continuous joins, monotonicity, radial lookup accuracy, 21 Chromium editor checks, endpoint constraints, both middle-point drags, undo/redo, proportional size changes, both curve modes, keyboard movement, real touch event dispatch in a mobile-sized viewport, JSON validation/round-trip, and a 3840 × 2160 PNG with exact black and corner-color pixels and no editing guides. Wave playback, zero-speed freezing, animated handle dragging, legacy setup compatibility, and pixel-exact frozen-frame PNG export also passed. The browser tests passed without application JavaScript errors.

**Test limitations:** the CDN-loaded dat.gui panel could not be exercised in this network-restricted environment. It is wired against the official dat.gui API; the fully exercised controls were the native fallback. Mobile testing used Chromium device emulation, not a physical iPhone or Safari. Browser local-storage persistence could not be exercised in the originless test page, so JSON files are the verified portable persistence path.

## Dependency references

The only third-party runtime library is dat.gui, published by the Data Arts Team / Google Creative Lab under Apache License 2.0. Its source is loaded externally rather than copied into this package.

```text
Official source: https://github.com/dataarts/dat.gui
Official API: https://github.com/dataarts/dat.gui/blob/master/API.md
Pinned release: https://github.com/dataarts/dat.gui/tree/v0.7.9
License: https://github.com/dataarts/dat.gui/blob/v0.7.9/LICENSE
```
