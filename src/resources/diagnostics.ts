import {
  loadOrScan,
  readWorkflow,
  validateWorkflow,
  type Diagnostic,
  type LibManifest,
} from '@mboss/core';

import type { ProjectPaths } from '../project.js';

import { workflowNames } from './current-workflow.js';

/**
 * What is wrong with the project right now.
 *
 * Computed on every read rather than cached: the
 * files change under this server continuously —
 * an agent edits `lib/`, a person edits the canvas
 * — and a stale answer to "what is wrong" is worse
 * than a slow one. Every workflow is validated,
 * so a project with many of them pays for all of
 * them on each read.
 */

export type WorkflowFindings = { name: string; diagnostics: Diagnostic[] };

/** A workflow file that could not be read at all. */
export type UnreadableWorkflow = { name: string; reason: string };

export type ProjectDiagnostics = {
  workflows: WorkflowFindings[];
  unreadable: UnreadableWorkflow[];
  manifestErrors: Array<{ file: string; message: string }>;
};

export async function projectDiagnostics(
  project: ProjectPaths,
): Promise<ProjectDiagnostics> {
  const manifest = loadOrScan(project.projectDir);
  const workflows: WorkflowFindings[] = [];
  const unreadable: UnreadableWorkflow[] = [];

  for (const name of workflowNames(project.mbossDir)) {
    const found = await findingsFor(project.mbossDir, name, manifest);

    if ('reason' in found) unreadable.push(found);
    else workflows.push(found);
  }

  return { workflows, unreadable, manifestErrors: manifest.errors };
}

/**
 * A file that will not parse is the very thing
 * this resource exists to report, and core throws
 * on one deliberately — so it is caught here and
 * carried, rather than taking every other
 * workflow's findings down with it.
 */
async function findingsFor(
  mbossDir: string,
  name: string,
  manifest: LibManifest,
): Promise<WorkflowFindings | UnreadableWorkflow> {
  try {
    const read = await readWorkflow(mbossDir, name);
    if (!read.ok) return { name, reason: read.error.code };

    return { name, diagnostics: validateWorkflow(read.ir, { manifest }) };
  } catch (error) {
    return { name, reason: (error as Error).message };
  }
}
