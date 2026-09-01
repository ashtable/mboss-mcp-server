import { z } from 'zod';

import { openProjectDatabase, type OpenDatabase } from '../debug/client.js';
import {
  MAX_RUNS,
  runsQuery,
  stepsQuery,
  toRun,
  toStep,
  type OperationOutputRow,
  type WorkflowStatusRow,
} from '../debug/queries.js';
import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';

const Input = z.object({
  runId: z.string().optional(),
  limit: z.number().int().min(1).max(MAX_RUNS).default(10),
});

const Step = z.object({
  functionID: z.number().int(),
  name: z.string(),
  startedAtEpochMs: z.number().optional(),
  completedAtEpochMs: z.number().optional(),
  error: z.string().optional(),
  childWorkflowID: z.string().optional(),
});

const Run = z.object({
  workflowId: z.string(),
  name: z.string(),
  status: z.string(),
  recoveryAttempts: z.number().int(),
  startedAt: z.iso.datetime(),
  durationMs: z.number().optional(),
  steps: z.array(Step).optional(),
});

const Output = z.object({ runs: z.array(Run) });

/**
 * Reads what the project's workflows actually did.
 *
 * A run's state is rows in the app's Postgres, put
 * there by DBOS, so this is where a question about
 * a crash or a retry is answered — not from any
 * state this server holds, which is none.
 *
 * Read-only, and only ever two tables.
 */
export function makeProjectDebug(open: OpenDatabase): ToolDefinition {
  return {
    name: 'project_debug',
    title: 'project.debug',
    description:
      "Reads recent workflow runs and their steps from the project's database.",
    inputSchema: Input,
    outputSchema: Output,
    run: (args, ctx) => debug(Input.parse(args), ctx, open),
  };
}

export const projectDebug = makeProjectDebug(openProjectDatabase);

async function debug(
  args: z.infer<typeof Input>,
  ctx: ToolContext,
  open: OpenDatabase,
) {
  const database = await open(ctx.projectDir);

  try {
    const runs = runsQuery(args);
    const rows = await database.query<WorkflowStatusRow>(
      runs.text,
      runs.values,
    );
    const found = rows.map(toRun);

    // Steps come back for a named run and not for
    // a listing: somebody asking what happened
    // recently wants the shape of the last few
    // runs, and reading every step of every one of
    // them is a second query per row for output
    // nobody asked for.
    const [run] = found;
    if (args.runId !== undefined && run !== undefined) {
      const steps = stepsQuery(args.runId);
      const stepRows = await database.query<OperationOutputRow>(
        steps.text,
        steps.values,
      );
      run.steps = stepRows.map(toStep);
    }

    return toolSuccess({ runs: found });
  } finally {
    await database.close();
  }
}
