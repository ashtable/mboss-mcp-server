import {
  WorkflowIRSchema,
  loadOrScan,
  type Diagnostic,
  type LibManifest,
  type WorkflowIR,
  type WorkflowSpec,
} from '@mboss/core';

import type { ToolError } from '../errors.js';
import type { ToolContext } from '../project.js';
import { resolveCurrentWorkflow } from '../resources/current-workflow.js';

/**
 * The few things the workflow tools all need:
 * which workflow a caller meant, what the project's
 * code-behind offers, and how to hand a document
 * back to `@mboss/core` as a spec.
 */

/**
 * The document format core writes. Taken from the
 * schema rather than written out again, the way
 * core takes it, so a format version can only ever
 * change in one place.
 */
const SCHEMA_URL = WorkflowIRSchema.shape.$schema.value;

/**
 * The name a spec is checked under.
 *
 * A spec carries no name — the tool call is
 * authoritative — and `workflow_validate` may be
 * given one that belongs to no workflow at all, so
 * checking it needs a name that no rule reads.
 * None of them do: validation is about the graph.
 */
const UNNAMED = 'draft';

export type NamedWorkflow =
  | { ok: true; name: string; ambiguity?: string }
  | { ok: false; error: ToolError };

/**
 * The workflow a call is about.
 *
 * A caller that names one gets that one, whether
 * or not it exists — reporting it missing is the
 * read's job, not this one's. A caller that names
 * none gets the project's current workflow, and is
 * told when that was a guess.
 */
export function namedWorkflow(
  name: string | undefined,
  ctx: ToolContext,
): NamedWorkflow {
  if (name !== undefined) return { ok: true, name };

  const outcome = resolveCurrentWorkflow(ctx.mbossDir);

  return outcome.ok ? { ok: true, ...outcome.current } : outcome;
}

/**
 * What the project's `lib/` offers, scanned.
 *
 * Every tool that validates passes this, so an
 * agent and a person looking at the same canvas
 * are told the same thing about the same document
 * — a wire carrying a type the code-behind does
 * not export is an error in both places, or in
 * neither. The scan is cached against a hash of
 * the files it read, so repeating it costs a
 * directory read.
 */
export function libManifest(ctx: ToolContext): LibManifest {
  return loadOrScan(ctx.projectDir);
}

/**
 * A document as a spec: the parts an edit is
 * allowed to set. The envelope core owns — the
 * schema, the version, the revision, the name — is
 * left off, so a spec built from a document cannot
 * carry a revision back in and freeze the conflict
 * check.
 */
export function specOf(ir: WorkflowIR): WorkflowSpec {
  return { title: ir.title, nodes: ir.nodes, edges: ir.edges };
}

/**
 * A spec as a document, so it can be checked
 * without being written anywhere.
 */
export function documentOf(spec: WorkflowSpec): WorkflowIR {
  return WorkflowIRSchema.parse({
    $schema: SCHEMA_URL,
    version: 1,
    revision: 1,
    name: UNNAMED,
    ...spec,
  });
}

/**
 * Findings split the way the tools report them.
 * The severity is the rule's, never the document's,
 * so this is a partition rather than a judgement.
 */
export function bySeverity(diagnostics: readonly Diagnostic[]): {
  errors: Diagnostic[];
  warnings: Diagnostic[];
} {
  return {
    errors: diagnostics.filter((found) => found.severity === 'error'),
    warnings: diagnostics.filter((found) => found.severity === 'warning'),
  };
}
