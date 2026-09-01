import {
  WorkflowIRSchema,
  WorkflowNameSchema,
  applySpec,
  workflowFile,
} from '@mboss/core';
import { z } from 'zod';

import { toolFailure } from '../errors.js';
import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';
import { libManifest } from './workflow.js';

const Input = z.object({
  name: WorkflowNameSchema,
  title: z.string().optional(),
});

const Output = z.object({
  name: WorkflowNameSchema,
  path: z.string(),
  /** A workflow is created once, so this is 1. */
  revision: z.literal(1),
  ir: WorkflowIRSchema,
});

/**
 * Creates an empty workflow.
 *
 * A draft with no trigger and no blocks is a legal
 * document — the canvas opens on one every time
 * somebody starts something — so this writes it
 * rather than insisting on a first block up front.
 *
 * The base revision is null, which is the claim
 * "there is no such workflow". Making it a claim
 * rather than an assumption is what turns creating
 * a workflow that already exists into a conflict
 * instead of an overwrite.
 */
export const workflowCreate: ToolDefinition = {
  name: 'workflow_create',
  title: 'workflow.create',
  description: 'Creates an empty workflow draft.',
  inputSchema: Input,
  outputSchema: Output,
  run: (args, ctx) => create(Input.parse(args), ctx),
};

async function create(args: z.infer<typeof Input>, ctx: ToolContext) {
  const outcome = await applySpec(
    ctx.mbossDir,
    {
      name: args.name,
      spec: { title: args.title, nodes: [], edges: [] },
      baseRevision: null,
    },
    { manifest: libManifest(ctx) },
  );

  if (!outcome.ok) return toolFailure(outcome.error);

  return toolSuccess({
    name: outcome.ir.name,
    path: workflowFile(ctx.mbossDir, outcome.ir.name),
    revision: outcome.ir.revision,
    ir: outcome.ir,
  });
}
