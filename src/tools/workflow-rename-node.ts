import {
  NodeIdSchema,
  WorkflowNameSchema,
  applySpec,
  readWorkflow,
} from '@mboss/core';
import { z } from 'zod';

import { toolFailure } from '../errors.js';
import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { renameNode } from './graph-edit.js';
import { toolSuccess } from './result.js';
import { libManifest, specOf } from './workflow.js';

const Input = z.object({
  workflow: WorkflowNameSchema,
  nodeId: NodeIdSchema,
  newId: NodeIdSchema.optional(),
  newTitle: z.string().optional(),
});

const Output = z.object({
  applied: z.literal(true),
  revision: z.number().int(),
  /**
   * How many other places named this node: the
   * ends of edges, the members of a loop's body,
   * the email a form wait is waiting on. Zero when
   * only the title changed.
   */
  updatedReferences: z.number().int(),
});

/**
 * Renames a node.
 *
 * There is no `baseRevision` to pass because there
 * is nothing for a caller to have written against:
 * the edit is described in terms of the document
 * as it stands, so the read happens here and the
 * write is based on what it found. A conflicting
 * write in between is reported like any other.
 */
export const workflowRenameNode: ToolDefinition = {
  name: 'workflow_rename_node',
  title: 'workflow.rename_node',
  description: 'Renames a node and every reference to it.',
  inputSchema: Input,
  outputSchema: Output,
  run: (args, ctx) => rename(Input.parse(args), ctx),
};

async function rename(args: z.infer<typeof Input>, ctx: ToolContext) {
  const read = await readWorkflow(ctx.mbossDir, args.workflow);
  if (!read.ok) return toolFailure(read.error);

  const edited = renameNode(read.ir, args);
  if (!edited.ok) throw new Error(edited.message);

  const outcome = await applySpec(
    ctx.mbossDir,
    {
      name: args.workflow,
      spec: specOf(edited.ir),
      baseRevision: read.ir.revision,
    },
    { manifest: libManifest(ctx) },
  );

  if (!outcome.ok) return toolFailure(outcome.error);

  return toolSuccess({
    applied: true,
    revision: outcome.ir.revision,
    updatedReferences: edited.updatedReferences,
  });
}
