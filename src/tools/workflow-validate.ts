import {
  DiagnosticSchema,
  WorkflowNameSchema,
  WorkflowSpecSchema,
  readWorkflow,
  validateWorkflow,
} from '@mboss/core';
import { z } from 'zod';

import { toolFailure } from '../errors.js';
import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';
import { bySeverity, documentOf, libManifest } from './workflow.js';

const Input = z.object({
  name: WorkflowNameSchema.optional(),
  spec: WorkflowSpecSchema.optional(),
});

const Output = z.object({
  valid: z.boolean(),
  errors: z.array(DiagnosticSchema),
  warnings: z.array(DiagnosticSchema),
});

/**
 * Checks a workflow without changing anything.
 *
 * Either a workflow that is on disk or a spec that
 * is not — the second is how an agent finds out
 * whether an edit would be accepted before asking
 * anyone to approve it. Exactly one of the two:
 * with both, there is no saying which was meant,
 * and the answers can differ.
 */
export const workflowValidate: ToolDefinition = {
  name: 'workflow_validate',
  title: 'workflow.validate',
  description:
    'Checks a workflow, or a spec not yet on disk, without changing anything.',
  inputSchema: Input,
  outputSchema: Output,
  run: (args, ctx) => check(Input.parse(args), ctx),
};

async function check(args: z.infer<typeof Input>, ctx: ToolContext) {
  const { name, spec } = args;

  if ((name === undefined) === (spec === undefined)) {
    throw new Error('Give exactly one of `name` or `spec`.');
  }

  const opts = { manifest: libManifest(ctx) };

  if (spec !== undefined)
    return answer(validateWorkflow(documentOf(spec), opts));

  const read = await readWorkflow(ctx.mbossDir, name ?? '');
  if (!read.ok) return toolFailure(read.error);

  return answer(validateWorkflow(read.ir, opts));
}

function answer(diagnostics: ReturnType<typeof validateWorkflow>) {
  const split = bySeverity(diagnostics);

  return toolSuccess({ valid: split.errors.length === 0, ...split });
}
