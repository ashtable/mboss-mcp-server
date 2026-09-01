import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A workflow document from the nested core
 * checkout's own fixtures, exactly as it is
 * written on disk.
 *
 * Reused rather than copied: these are the
 * documents core validates and compiles in its own
 * tests, so a schema checked against them is
 * checked against real authored workflows rather
 * than against something written to pass.
 *
 * Deliberately unparsed. A parse fills in every
 * default, and whether a schema accepts a document
 * with its defaults left out is the question.
 *
 * This module is imported only by tests, but it
 * is not a `*.test.ts` — vitest would then try to
 * run it as a suite with no tests in it.
 */
export function coreFixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(
      `../../mboss-core/fixtures/ir/${name}.workflow.json`,
      import.meta.url,
    ),
  );

  return JSON.parse(readFileSync(path, 'utf8'));
}
