import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

/**
 * A project the type-check gate can be pointed at.
 *
 * Two files beyond an empty project: a
 * `tsconfig.json`, because `typecheckProject`
 * reads the project's own, and the contract module
 * the generated workflow registry imports its
 * types from. Both are stubs standing in for what
 * the scaffold writes — a fixture with the real
 * runtime in it would need the app's dependencies
 * installed, which is the end-to-end suite's job
 * rather than a unit test's.
 */
export function makeBuildableProject(): ProjectFixture {
  const fixture = makeFixtureProject();

  writeFileSync(
    join(fixture.dir, 'tsconfig.json'),
    `${JSON.stringify(FIXTURE_TSCONFIG, null, 2)}\n`,
    'utf8',
  );

  mkdirSync(join(fixture.dir, 'src', 'app'), { recursive: true });
  writeFileSync(
    join(fixture.dir, 'src', 'app', 'contract.ts'),
    CONTRACT_STUB,
    'utf8',
  );

  return fixture;
}

/**
 * Deliberately without `types: ['node']`: a
 * fixture has no `node_modules`, and the check
 * under test is about the code, not the
 * environment.
 */
const FIXTURE_TSCONFIG = {
  compilerOptions: {
    target: 'ES2023',
    lib: ['ES2023'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    skipLibCheck: true,
  },
  include: ['lib', 'src'],
};

const CONTRACT_STUB = [
  "// Stands in for the scaffold's own contract",
  '// module, which the generated registry imports',
  '// its types from.',
  'export type WorkflowEntry = { name: string };',
  'export type ScheduleEntry = { name: string };',
  '',
].join('\n');

/** A directory that is not an mBoss project. */
export function makeBareDirectory(): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mboss-mcp-')));

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
