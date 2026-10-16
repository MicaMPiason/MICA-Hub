import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
process.chdir(projectRoot);
// Only clear the generated output at this exact project path; never source data.
const output = path.resolve(projectRoot, 'dist');
if (path.dirname(output) !== path.resolve(projectRoot) || path.basename(output) !== 'dist') throw new Error('Unsafe build output');
await rm(output, { recursive: true, force: true });
await mkdir('dist/assets/js', { recursive: true });
await cp('assets/css', 'dist/assets/css', { recursive: true });
await cp('assets/Logotipo M com Hub Azul-Ciano.png', 'dist/assets/Logotipo M com Hub Azul-Ciano.png');
// Explicit allowlist: never publish private data.js, .env, test fixtures or backups.
for (const name of ['search.js', 'proposals.js', 'pipeline.js', 'sidebar.js', 'app.js', 'supabase-config.js', 'theme-init.js']) {
  await cp('assets/js/' + name, 'dist/assets/js/' + name);
}
await build({ entryPoints: ['src/cloud.js'], bundle: true, format: 'iife', target: ['es2022'], outfile: 'dist/assets/js/cloud.js', minify: true, legalComments: 'none' });
const html = await readFile('index.html', 'utf8');
await writeFile('dist/index.html', html);
console.log('Built dist with Supabase Auth and private per-user storage.');
