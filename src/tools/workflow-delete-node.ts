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

import { deleteNode } from './graph-edit.js';
import { toolSuccess } from './result.js';
import { libManifest, specOf } from './workflow.js';

const Input = z.object({
  workflow: WorkflowNameSchema,
  nodeId: NodeIdSchema,
  /**
   * Whether to join what was on either side of the
   * node, so that deleting a block out of a chain
   * leaves a chain rather than two halves.
   */
  reconnect: z.boolean().default(true),
});

const Output = z.object({
  applied: z.literal(true),
  revision: z.number().int(),
  removedEdges: z.array(z.string()),
  /** Absent when there was no unambiguous gap to close. */
  bridgedEdge: z.string().optional(),
});

/**
 * Deletes a node and everything wired to it.
 *
 * A delete that leaves a form wait pointing at the
 * email it just removed is refused rather than
 * guessed at: validation reports the broken wait
 * and nothing is written, so the author decides
 * what that wait should do instead.
 */
export const workflowDeleteNode: ToolDefinition = {
  name: 'workflow_delete_node',
  title: 'workflow.delete_node',
  description:
    'Deletes a node and its edges, bridging the gap where that is unambiguous.',
  inputSchema: Input,
  outputSchema: Output,
  run: (args, ctx) => remove(Input.parse(args), ctx),
};

async function remove(args: z.infer<typeof Input>, ctx: ToolContext) {
  const read = await readWorkflow(ctx.mbossDir, args.workflow);
  if (!read.ok) return toolFailure(read.error);

  const edited = deleteNode(read.ir, args);
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
    removedEdges: edited.removedEdges,
    ...(edited.bridgedEdge === undefined
      ? {}
      : { bridgedEdge: edited.bridgedEdge }),
  });
}
