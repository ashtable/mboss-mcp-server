import {
  DiagnosticSchema,
  DiffSummarySchema,
  WorkflowNameSchema,
  WorkflowSpecSchema,
  applyProposal,
  applySpec,
  proposeSpec,
  readProposal,
} from '@mboss/core';
import { z } from 'zod';

import { toolFailure } from '../errors.js';
import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';
import { bySeverity, libManifest } from './workflow.js';

const Input = z.object({
  name: WorkflowNameSchema,
  /**
   * The whole document the workflow should become,
   * not a patch: the server works out what changed.
   * It carries no name of its own, so an approved
   * edit cannot land on a file nobody agreed to
   * change.
   */
  spec: WorkflowSpecSchema,
  dryRun: z.boolean().default(true),
  /**
   * The revision the spec was written against.
   * Omitted is the claim that this workflow does
   * not exist yet, so an existing one conflicts.
   */
  baseRevision: z.number().int().optional(),
  /**
   * The previewed edit a person approved. When one
   * is named it is what lands — approval was for
   * that edit, not for whatever the arguments say
   * now.
   */
  proposalId: z.string().optional(),
});

const Output = z.object({
  /**
   * True on every answer that has one. A spec with
   * an error is refused outright, coded
   * `VALIDATION_FAILED`, because nothing was
   * proposed and nothing was written — there is no
   * proposal to come back and approve.
   */
  valid: z.boolean(),
  errors: z.array(DiagnosticSchema),
  warnings: z.array(DiagnosticSchema),
  summary: DiffSummarySchema,
  /** Absent on an apply that skipped the preview. */
  proposalId: z.string().optional(),
  applied: z.boolean(),
  /** Present once something has been written. */
  revision: z.number().int().optional(),
});

/**
 * The one way an agent changes a workflow.
 *
 * A dry run validates the spec, works out the
 * diff, and writes the whole thing down as a
 * proposal — which is what a running canvas
 * watches for and draws as a preview. Applying
 * takes the same path a person clicking "approve"
 * in the sidebar takes, inside the same lock, so
 * two writers cannot interleave whichever way the
 * edit arrived.
 */
export const workflowApplySpec: ToolDefinition = {
  name: 'workflow_apply_spec',
  title: 'workflow.apply_spec',
  description:
    'Previews a complete workflow document as a proposal, or applies one.',
  inputSchema: Input,
  outputSchema: Output,
  run: (args, ctx) => apply(Input.parse(args), ctx),
};

async function apply(args: z.infer<typeof Input>, ctx: ToolContext) {
  const opts = { manifest: libManifest(ctx) };
  const baseRevision = args.baseRevision ?? null;

  if (args.dryRun) {
    const outcome = await proposeSpec(
      ctx.mbossDir,
      {
        name: args.name,
        spec: args.spec,
        baseRevision,
        proposedBy: ctx.proposedBy,
      },
      opts,
    );

    if (!outcome.ok) return toolFailure(outcome.error);

    const { proposal } = outcome;

    return toolSuccess({
      valid: true,
      ...bySeverity(proposal.diagnostics),
      summary: proposal.summary,
      proposalId: proposal.id,
      applied: false,
    });
  }

  if (args.proposalId !== undefined) {
    const wrongWorkflow = await namesAnother(
      ctx.mbossDir,
      args.proposalId,
      args.name,
    );
    if (wrongWorkflow) {
      return toolFailure({ code: 'PROPOSAL_NOT_FOUND', id: args.proposalId });
    }
  }

  const outcome =
    args.proposalId === undefined
      ? await applySpec(
          ctx.mbossDir,
          { name: args.name, spec: args.spec, baseRevision },
          opts,
        )
      : await applyProposal(ctx.mbossDir, args.proposalId, opts);

  if (!outcome.ok) return toolFailure(outcome.error);

  return toolSuccess({
    valid: true,
    ...bySeverity(outcome.diagnostics),
    summary: outcome.summary,
    ...(args.proposalId === undefined ? {} : { proposalId: args.proposalId }),
    applied: true,
    revision: outcome.ir.revision,
  });
}

/**
 * Whether an approved edit would land somewhere
 * other than the workflow this call named.
 *
 * `applyProposal` takes its target from the
 * proposal, so a `proposalId` naming a different
 * workflow than `name` would write to a file the
 * caller never asked about — and the answer says
 * nothing about which one it wrote, so nobody finds
 * out. The two arguments disagreeing is a bug in
 * the caller, not a preference to be resolved
 * silently, and this is the same invariant the spec
 * carrying no name of its own protects from the
 * other side.
 *
 * Read outside the lock, which is safe because it
 * only ever refuses: `applyProposal` re-reads and
 * decides authoritatively inside it.
 */
async function namesAnother(
  mbossDir: string,
  id: string,
  name: string,
): Promise<boolean> {
  const proposal = await readProposal(mbossDir, id);

  return proposal !== undefined && proposal.workflow !== name;
}
