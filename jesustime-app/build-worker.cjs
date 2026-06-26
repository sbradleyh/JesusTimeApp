// build-worker.cjs
// Runs after `vite build` — embeds dist/index.html into worker-app.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
const escaped = html
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n')
  .replace(/\r/g, '');

const worker = `// snowy-wood-35ec — JesusTime app (built by Vite)
const HTML = "${escaped}";
export default {
  async fetch() {
    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
`;

fs.writeFileSync(path.join(__dirname, 'worker-app.js'), worker);
console.log('✓ worker-app.js built (' + Math.round(worker.length / 1024) + ' KB)');
