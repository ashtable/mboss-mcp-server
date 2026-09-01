import {
  DiagnosticSchema,
  WorkflowIRSchema,
  WorkflowNameSchema,
  readWorkflow,
  validateWorkflow,
  workflowFile,
} from '@mboss/core';
import { z } from 'zod';

import { toolFailure } from '../errors.js';
import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';
import { libManifest, namedWorkflow } from './workflow.js';

const Input = z.object({
  /**
   * Omitted means the project's current workflow —
   * the one the editor has open, or the only one
   * there is, or the one changed most recently.
   */
  name: WorkflowNameSchema.optional(),
});

const Output = z.object({
  name: WorkflowNameSchema,
  path: z.string(),
  revision: z.number().int(),
  ir: WorkflowIRSchema,
  diagnostics: z.array(DiagnosticSchema),
});

/**
 * Reads a workflow.
 *
 * The revision comes back with it because it is
 * half of every edit that follows: an agent hands
 * it straight back as `baseRevision`, and that is
 * what makes a conflicting change a refusal
 * instead of a silent overwrite.
 */
export const workflowGet: ToolDefinition = {
  name: 'workflow_get',
  title: 'workflow.get',
  description: 'Reads a workflow document, its revision and its diagnostics.',
  inputSchema: Input,
  outputSchema: Output,
  run: (args, ctx) => get(Input.parse(args), ctx),
};

async function get(args: z.infer<typeof Input>, ctx: ToolContext) {
  const named = namedWorkflow(args.name, ctx);
  if (!named.ok) return toolFailure(named.error);

  const read = await readWorkflow(ctx.mbossDir, named.name);
  if (!read.ok) return toolFailure(read.error);

  return toolSuccess(
    {
      name: read.ir.name,
      path: workflowFile(ctx.mbossDir, read.ir.name),
      revision: read.ir.revision,
      ir: read.ir,
      diagnostics: validateWorkflow(read.ir, { manifest: libManifest(ctx) }),
    },
    named.ambiguity,
  );
}
