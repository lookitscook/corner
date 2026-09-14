"""Inline the first-party assets. dat.gui loads from its pinned CDN URLs."""
from pathlib import Path
ROOT = Path(__file__).resolve().parent
html = (ROOT / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + (ROOT / 'styles.css').read_text() + '\n</style>')
for name in ['engine.js', 'fallback-gui.js', 'app.js']:
    code = (ROOT / name).read_text().replace('</script', '<\\/script')
    html = html.replace(f'<script src="{name}"></script>', f'<script>\n{code}\n</script>')
output = ROOT.parent / 'corner-gradient.html'
output.write_text(html)
print(output, output.stat().st_size, 'bytes')
