import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';

const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);

/**
 * sql.js ships a WASM file alongside its JS shim. We bundle the JS into the
 * extension (no external) so it's self-contained, and copy the WASM next to
 * the bundled extension.cjs so the runtime can read it via __dirname. This is
 * the key thing that makes the packaged `.vsix` installable without a
 * workspace `node_modules`.
 */
function copySqlJsWasmPlugin() {
  return {
    name: 'copy-sql-js-wasm',
    setup(build) {
      build.onEnd(() => {
        const wasmSrc = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
        const wasmDest = path.join('dist', 'sql-wasm.wasm');
        fs.mkdirSync(path.dirname(wasmDest), { recursive: true });
        fs.copyFileSync(wasmSrc, wasmDest);
      });
    },
  };
}

const opts = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // `vscode` must remain external — provided by the VS Code host.
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  plugins: [copySqlJsWasmPlugin()],
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('esbuild watching...');
} else {
  await esbuild.build(opts);
}
