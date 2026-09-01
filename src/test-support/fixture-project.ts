import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mbossDirOf } from '@mboss/core';

/**
 * Throwaway directories for tests that touch the
 * filesystem.
 *
 * This module is imported only by tests, but it
 * is not a `*.test.ts` — vitest would then try to
 * run it as a suite with no tests in it.
 */

export type Fixture = {
  dir: string;
  cleanup(): void;
};

/**
 * A directory holding an empty mBoss project.
 *
 * The path is resolved through `realpathSync`
 * because the system temp directory is a symlink
 * on macOS, and a test comparing the directory it
 * asked for against the one a tool reports would
 * otherwise fail for the wrong reason.
 */
export function makeFixtureProject(): Fixture {
  const fixture = makeBareDirectory();
  mkdirSync(join(mbossDirOf(fixture.dir), 'workflows'), { recursive: true });

  return fixture;
}

/** A directory that is not an mBoss project. */
export function makeBareDirectory(): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mboss-mcp-')));

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
