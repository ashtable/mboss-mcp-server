import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { expect } from 'vitest';

/**
 * Compares a generated file against the copy
 * checked in beside the source it is generated
 * from.
 *
 * With `UPDATE_GOLDENS=1` the file is rewritten
 * and the test still fails: a regenerating run
 * must never be mistakable for a passing run, or
 * a wrong output silently becomes the new
 * definition of right.
 *
 * This module is imported only by tests, but it
 * is not a `*.test.ts` — vitest would then try to
 * run it as a suite with no tests in it.
 */
export function expectGolden(path: string, actual: string): void {
  if (process.env['UPDATE_GOLDENS'] === '1') {
    writeFileSync(path, actual, 'utf8');
    throw new Error(
      `rewrote ${basename(path)}. Read the diff, then re-run ` +
        `without UPDATE_GOLDENS=1 to confirm it passes.`,
    );
  }

  expect(actual).toBe(readFileSync(path, 'utf8'));
}
