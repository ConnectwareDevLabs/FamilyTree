import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(file => {
      copyRecursive(path.join(src, file), path.join(dest, file));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ── Bundle app.js from modular js/ files ────────────
const jsFiles = [
  'data.js', 'trees.js', 'collapse.js', 'person.js', 'views.js',
  'layout.js', 'list.js', 'actions.js', 'member-form.js', 'multi-child.js',
  'view-member.js', 'remove.js', 'export.js', 'ui-utils.js', 'pan-zoom.js',
  'drag-reorder.js', 'search.js', 'graph.js', 'auth.js', 'boot.js'
];

const jsDir = path.join(rootDir, 'js');
const appJsPath = path.join(rootDir, 'app.js');

let combinedJs = jsFiles.map(file => {
  const filePath = path.join(jsDir, file);
  if (fs.existsSync(filePath)) {
    return `// ── ${file} ──\n` + fs.readFileSync(filePath, 'utf8');
  }
  return '';
}).join('\n\n');

fs.writeFileSync(appJsPath, combinedJs, 'utf8');
console.log(`Bundled ${jsFiles.length} modules into app.js (${combinedJs.length} bytes).`);

['index.html', 'admin.html', 'styles.css', 'app.js', 'js', 'css', 'robots.txt', 'sitemap.xml', 'ads.txt'].forEach(item => {
  const srcPath = path.join(rootDir, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, path.join(distDir, item));
  }
});

console.log('Build complete! Static assets prepared in dist/ directory.');
