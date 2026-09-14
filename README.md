# Corner — Gradient Studio

A JavaScript canvas editor built with Vite and npm. No Python or CMS is required.

Use Node.js 22.12+ (22.x) or 24+ and run these commands from this repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To build and preview the static site:

```sh
npm run build
npm run preview
```

Deploy the contents of `dist/` to any static host. Assets use relative URLs, so the build also works under a subdirectory. dat.gui is installed through npm and bundled locally; the app makes no CDN requests and needs no backend or Decap.

For a portable HTML file that opens directly in a browser:

```sh
npm run build:standalone
```

This refreshes the checked-in `corner-gradient.html` at the repository root. The `dist/` directory and new test results are ignored by Git.

Run the geometry and browser checks with:

```sh
npx playwright install chromium
npm test
```

Alternatively, set `CHROMIUM` to an existing Chrome/Chromium executable. `npm run test:unit` runs just the geometry checks; `npm run test:browser` builds and tests the production site, including locally bundled controls, animation, dragging, keyboard input, persistence, setup files, PNG exports, and mobile touch interaction.

See [the editor guide](corner-gradient/README.md) for controls and rendering details.
