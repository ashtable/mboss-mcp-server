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

/** A fixture that is a project, so it has a `.mboss/`. */
export type ProjectFixture = Fixture & { mbossDir: string };

/**
 * A directory holding an empty mBoss project.
 *
 * The path is resolved through `realpathSync`
 * because the system temp directory is a symlink
 * on macOS, and a test comparing the directory it
 * asked for against the one a tool reports would
 * otherwise fail for the wrong reason.
 */
export function makeFixtureProject(): ProjectFixture {
  const fixture = makeBareDirectory();
  const mbossDir = mbossDirOf(fixture.dir);
  mkdirSync(join(mbossDir, 'workflows'), { recursive: true });

  return { ...fixture, mbossDir };
}

/** A directory that is not an mBoss project. */
export function makeBareDirectory(): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mboss-mcp-')));

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
