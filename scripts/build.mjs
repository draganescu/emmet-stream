// Bundles src/app.js (with Emmet, the tokenizer, the kit stylesheet and the
// replay demos) and copies the static files into dist/.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });
const copyStatic = () => { cpSync('src/index.html', 'dist/index.html'); cpSync('src/app.css', 'dist/app.css'); };

const options = {
  entryPoints: ['src/app.js'],
  bundle: true,
  minify: !watch,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/app.js',
  loader: { '.css': 'text', '.txt': 'text' },
  plugins: [{ name: 'static', setup(b) { b.onEnd(copyStatic); } }],
  logLevel: 'info',
};

if (watch) { const ctx = await esbuild.context(options); await ctx.watch(); }
else await esbuild.build(options);
