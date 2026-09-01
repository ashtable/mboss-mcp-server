import { resolve } from 'node:path';

import { build } from 'esbuild';

/**
 * Builds the single-file server the way it ships.
 *
 * Tests speak to a real child process rather than
 * to an in-process server, and plain `node`
 * cannot load this repo's TypeScript, so they
 * bundle it first. The bundle is also the
 * artifact under test in its own right: nothing
 * proves a tool survived tree-shaking except
 * listing it from the built file.
 *
 * This module is imported only by tests, but it
 * is not a `*.test.ts` — vitest would then try to
 * run it as a suite with no tests in it.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');

/**
 * An ES module has none of `require`,
 * `__filename` or `__dirname`, but the TypeScript
 * compiler inside ts-morph reaches for all three
 * at run time — to load `fs`, and to probe
 * whether the filesystem is case-sensitive.
 * esbuild's own `require` stand-in defers to a
 * real one if it finds it in scope, so the bundle
 * opens by making all three.
 */
const commonJsGlobals = [
  "import { createRequire as __mbossCreateRequire } from 'node:module';",
  'var require = __mbossCreateRequire(import.meta.url);',
  'var __filename = import.meta.filename;',
  'var __dirname = import.meta.dirname;',
].join('\n');

/** Builds the bundle and returns its path. */
export async function buildServerBundle(): Promise<string> {
  const outfile = resolve(repoRoot, 'dist', 'server.js');

  await build({
    entryPoints: [resolve(repoRoot, 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: { js: commonJsGlobals },
    // elkjs reaches for a real web worker behind
    // a guarded require, and only when a caller
    // asks for one — which this server never
    // does. Left external, its absence stays a
    // caught failure at run time instead of
    // becoming a build error here.
    external: ['web-worker'],
  });

  return outfile;
}
