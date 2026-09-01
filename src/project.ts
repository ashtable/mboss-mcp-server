import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { mbossDirOf } from '@mboss/core';

import type { ToolError } from './errors.js';

/**
 * Where a tool call runs. Found once per call and
 * handed to the tool, so no tool builds a
 * `.mboss/` path of its own.
 */
export type ToolContext = {
  projectDir: string;
  mbossDir: string;
};

export type ResolveProjectOutcome =
  { ok: true; project: ToolContext } | { ok: false; error: ToolError };

/**
 * Finds the project a directory belongs to.
 *
 * The search walks up rather than looking only at
 * the directory it was given: an agent's working
 * directory is usually somewhere inside a project
 * — `lib/`, a workspace folder — rather than at
 * its root, and a server started there is still
 * working on that project.
 */
export function resolveProject(cwd: string): ResolveProjectOutcome {
  const from = resolve(cwd);
  let dir = from;

  while (true) {
    const mbossDir = mbossDirOf(dir);
    if (existsSync(mbossDir)) {
      return { ok: true, project: { projectDir: dir, mbossDir } };
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { ok: false, error: { code: 'NOT_AN_MBOSS_PROJECT', path: from } };
}
