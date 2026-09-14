import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
let html = await readFile(new URL('index.html', dist), 'utf8');
const license = await readFile(new URL('dat.gui.LICENSE.txt', dist), 'utf8');
html = html.replace('<!doctype html>', () => `<!doctype html>\n<!--\n${license}\n-->`);

// Inline Vite's generated entry bundle and stylesheet for direct file:// use.
// Keep this fail-fast: new asset types or code splitting require explicit support.
for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)) {
  const code = await readFile(new URL(match[1], dist), 'utf8');
  html = html.replace(match[0], () => `<script type="module">\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`);
}
for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)) {
  const css = await readFile(new URL(match[1], dist), 'utf8');
  html = html.replace(match[0], () => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`);
}
if (/(?:src|href)="\.\/assets\//.test(html)) {
  throw new Error('The build contains assets that cannot be inlined.');
}
await writeFile(new URL('corner-gradient.html', root), html);
console.log('Built corner-gradient.html');
