# Corner — Gradient Studio

A JavaScript canvas editor with smooth and ordered-dither gradient styles, built with Vite and npm. dat.gui is bundled locally; the app needs no CDN, backend, or CMS.

## Development

Use Node.js 24 (`nvm use` if you use nvm), then run from the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The dev server reloads changes to the source files.

## Build and preview

```sh
npm run build
npm run preview
```

Vite generates the static site in `dist/`. The preview server serves that build locally. Generated files are ignored by Git.

## Tests

```sh
npx playwright install chromium
npm test
```

`npm run test:unit` runs the geometry checks. `npm run test:browser` builds and tests the production site, covering controls, animation, dragging, keyboard input, persistence, setup files, PNG exports, and mobile touch. Alternatively, set `CHROMIUM` to an existing Chrome/Chromium executable.

## GitHub Pages

In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.

The [Pages workflow](.github/workflows/pages.yml) installs dependencies, runs tests against a production build, and deploys `dist/` after pushes to `main`. Pull requests run the same checks without deploying. You can also run the workflow manually on `main`.

The workflow builds with the repository name as the base path (`/corner/` for `lookitscook/corner`), targeting `https://lookitscook.github.io/corner/`. To test that path locally:

```sh
VITE_BASE_PATH=/corner/ npm test
VITE_BASE_PATH=/corner/ npm run preview
```

For a custom domain or a user/organization Pages site at the domain root, set the workflow's `VITE_BASE_PATH` to `/`. This follows [Vite's GitHub Pages deployment guidance](https://vite.dev/guide/static-deploy.html#github-pages).

## Structure

```text
index.html              Vite entry page
src/main.js             Editor UI, state, and exports
src/engine.js           Geometry and Canvas 2D rendering
src/render-settings.js Rendering parameters and validation
src/styles.css          Layout and control styling
public/                 Static assets and third-party license
tests/                 Geometry and Playwright browser tests
docs/editor.md         Controls and rendering guide
.github/workflows/      GitHub Pages build and deployment
```

See [the editor guide](docs/editor.md) for controls and rendering details.
