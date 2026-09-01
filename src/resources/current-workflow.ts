import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { stateFile, workflowsDir } from '@mboss/core';

import type { ToolError } from '../errors.js';

/**
 * Which workflow a caller means when it names
 * none.
 *
 * An agent working in a terminal has no editor
 * selection to read, so "the current workflow" has
 * to be answerable from the project alone. Three
 * answers in order of how much they are worth: the
 * editor's own hint, the only workflow there is,
 * and a guess. A guess says so.
 */

/**
 * What core appends to a workflow's name to make
 * its file name.
 *
 * Core builds that path and does not publish the
 * suffix, and this is the only place in the server
 * that has to run the path backwards — from a
 * directory listing to the names in it. Should the
 * layout ever change, the resolver goes quiet
 * rather than wrong, and every test below fails.
 */
const FILE_SUFFIX = '.workflow.json';

export type CurrentWorkflow = {
  name: string;
  /**
   * Present only when the answer was a guess, and
   * then it says so in a sentence a caller can
   * show a person.
   */
  ambiguity?: string;
};

export type CurrentWorkflowOutcome =
  { ok: true; current: CurrentWorkflow } | { ok: false; error: ToolError };

/**
 * The workflow a caller that named none most
 * likely means.
 */
export function resolveCurrentWorkflow(
  mbossDir: string,
): CurrentWorkflowOutcome {
  const names = workflowNames(mbossDir);

  const active = activeWorkflow(mbossDir);
  if (active !== undefined && names.includes(active)) {
    return { ok: true, current: { name: active } };
  }

  const [only] = names;
  if (only === undefined) {
    return { ok: false, error: { code: 'NO_CURRENT_WORKFLOW' } };
  }

  if (names.length === 1) return { ok: true, current: { name: only } };

  const guess = mostRecentlyChanged(mbossDir, names);

  return {
    ok: true,
    current: {
      name: guess,
      ambiguity:
        `This project has ${names.length} workflows and none of them is ` +
        `open in an editor, so \`${guess}\` was chosen for being the most ` +
        `recently changed. Name one to be certain.`,
    },
  };
}

/**
 * Every workflow in the project, by name, sorted.
 *
 * Shared with the resource that reports on all of
 * them, because running the file layout backwards
 * is the one thing both have to do and it should
 * only be written once.
 */
export function workflowNames(mbossDir: string): string[] {
  return entriesOf(workflowsDir(mbossDir))
    .filter((entry) => entry.endsWith(FILE_SUFFIX))
    .map((entry) => entry.slice(0, -FILE_SUFFIX.length))
    .sort();
}

/**
 * A project with no `workflows/` directory has no
 * workflows, which is a thing to answer rather
 * than a thing to fail on — a project is scaffolded
 * before anything is drawn in it.
 */
function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * The workflow the extension last had open.
 *
 * `state.json` is a hint written by another
 * process, gitignored and hand-editable, so
 * anything wrong with it — missing, half-written,
 * naming a workflow since deleted — means "no
 * hint" rather than an error. The caller checks
 * that the name is still a workflow.
 */
function activeWorkflow(mbossDir: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(stateFile(mbossDir), 'utf8'));
  } catch {
    return undefined;
  }

  if (parsed === null || typeof parsed !== 'object') return undefined;

  const { activeWorkflow: active } = parsed as { activeWorkflow?: unknown };

  return typeof active === 'string' ? active : undefined;
}

/**
 * The last of the names to have been written to.
 * Ties go to the name that sorts first, so the
 * answer does not depend on the order a directory
 * happened to be read in.
 */
function mostRecentlyChanged(mbossDir: string, names: string[]): string {
  const dir = workflowsDir(mbossDir);
  let newest = names[0] ?? '';
  let newestAt = -Infinity;

  for (const name of names) {
    const at = statSync(join(dir, `${name}${FILE_SUFFIX}`)).mtimeMs;
    if (at > newestAt) {
      newest = name;
      newestAt = at;
    }
  }

  return newest;
}
