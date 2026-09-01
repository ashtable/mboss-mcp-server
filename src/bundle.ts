import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

/**
 * Builds the single-file server the way it ships.
 *
 * A project vendors one file and runs it with its
 * own Node — no install step — so everything the
 * server needs, this repo's TypeScript and the
 * nested core alike, has to be inlined here.
 *
 * Tests speak to a real child process rather than
 * to an in-process server, and plain `node` cannot
 * load this repo's TypeScript, so they build the
 * bundle too. That is deliberate: the bundle is the
 * artifact under test in its own right, and nothing
 * proves a tool survived tree-shaking except
 * listing it from the built file.
 *
 * `npm run build:bundle` runs this file, which is
 * why nothing in it is imported from a sibling:
 * plain `node` reads the TypeScript here, but it
 * will not follow a `.js` specifier to a `.ts`
 * file.
 */

const repoRoot = resolve(import.meta.dirname, '..');

/** Where the build leaves what it made. */
export type Bundle = {
  /** The single file a project vendors. */
  server: string;
  /** The one line the extension compares against. */
  version: string;
};

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

/** Builds the bundle and the VERSION beside it. */
export async function buildBundle(): Promise<Bundle> {
  const dist = resolve(repoRoot, 'dist');
  const bundle = {
    server: resolve(dist, 'server.js'),
    version: resolve(dist, 'VERSION'),
  };

  await build({
    entryPoints: [resolve(repoRoot, 'src', 'main.ts')],
    outfile: bundle.server,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: { js: commonJsGlobals },
    // Nothing bundled here may assume its own
    // dependencies are on disk beside it, which is
    // what `createRequire` is for. The stand-in
    // says what a vendored copy can promise.
    alias: {
      'node:module': resolve(repoRoot, 'src', 'vendored-node-module.ts'),
    },
    // elkjs reaches for a real web worker behind
    // a guarded require, and only when a caller
    // asks for one — which this server never
    // does. Left external, its absence stays a
    // caught failure at run time instead of
    // becoming a build error here.
    external: ['web-worker'],
  });

  writeFileSync(bundle.version, `${bundleVersion()}\n`, 'utf8');

  return bundle;
}

/**
 * What this build calls itself.
 *
 * The version branch is this repo's real version —
 * `package.json`'s never moves — and the commit is
 * what tells two builds of the same branch apart.
 */
export function versionString({
  branch,
  sha,
  packageVersion,
}: {
  branch?: string;
  sha?: string;
  packageVersion: string;
}): string {
  const name = branch ?? packageVersion;

  return sha === undefined ? name : `${name}+${sha.slice(0, 7)}`;
}

function bundleVersion(): string {
  return versionString({ ...checkout(), packageVersion: packageVersion() });
}

/**
 * What git says about this checkout, if anything.
 *
 * A build from a tarball has no git at all, and a
 * build of a pull request has a detached HEAD whose
 * branch reads back as `HEAD` — the name is in the
 * environment there instead.
 */
function checkout(): { branch?: string; sha?: string } {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const named = branch === 'HEAD' ? process.env.GITHUB_HEAD_REF : branch;

  return { branch: named, sha: git('rev-parse', 'HEAD') };
}

function git(...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function packageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
  ) as { version: string };

  return manifest.version;
}

/**
 * Building is what this file does when it is run
 * rather than imported.
 */
if (process.argv[1] === import.meta.filename) await buildBundle();
