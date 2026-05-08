import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Mark sql.js as external so its WASM binary is resolvable at runtime from
  // the extension's node_modules (WASM files can't be bundled into a CJS file).
  external: ['vscode', 'sql.js'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('esbuild watching...');
} else {
  await esbuild.build(opts);
}
