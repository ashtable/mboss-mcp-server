/**
 * The two reads `project_debug` makes, and the
 * mapping from DBOS's columns to the fields the
 * tool answers with.
 *
 * Raw SQL rather than the DBOS client library, on
 * purpose. This server ships as one bundled file
 * with no install step, vendored into somebody
 * else's project, and it reads *their* database —
 * written by whichever version of DBOS their app
 * runs. Two selects against two documented tables
 * carry none of that coupling, and a client that
 * wants to create its own schema is the wrong
 * thing to point at a database this tool is only
 * ever allowed to read.
 *
 * The price is that the column names below are
 * knowledge kept by hand. It is paid for by tests:
 * the mappers here, and an assertion against a
 * real generated app's schema in the end-to-end
 * suite.
 */

/**
 * The most runs one call may ask for.
 *
 * Written down once: `project_debug`'s input
 * schema is built from it, so the cap is enforced
 * at the boundary rather than silently truncated
 * further in.
 */
export const MAX_RUNS = 50;

/**
 * A `bigint` column as `pg` hands it over.
 *
 * node-postgres returns `int8` as text, because a
 * 64-bit integer does not always fit a JavaScript
 * number. Every one of these columns holds epoch
 * milliseconds or an attempt count, which do fit,
 * so they are read back as numbers — and the
 * union also covers a caller that has installed a
 * type parser of its own.
 */
type BigIntColumn = string | number;

/** A row of `dbos.workflow_status`, as selected. */
export type WorkflowStatusRow = {
  workflow_uuid: string;
  name: string;
  status: string;
  recovery_attempts: BigIntColumn;
  created_at: BigIntColumn;
  completed_at: BigIntColumn | null;
};

/** A row of `dbos.operation_outputs`, as selected. */
export type OperationOutputRow = {
  function_id: number;
  function_name: string;
  started_at_epoch_ms: BigIntColumn | null;
  completed_at_epoch_ms: BigIntColumn | null;
  error: string | null;
  child_workflow_id: string | null;
};

/**
 * One step of a run.
 *
 * There is no attempt count here and there must
 * not be one: DBOS counts recovery attempts per
 * run and records nothing per step, so a field
 * for it could only ever be invented.
 */
export type DebugStep = {
  functionID: number;
  name: string;
  startedAtEpochMs?: number;
  completedAtEpochMs?: number;
  error?: string;
  childWorkflowID?: string;
};

/** One run of a workflow. */
export type DebugRun = {
  workflowId: string;
  name: string;
  status: string;
  recoveryAttempts: number;
  startedAt: string;
  durationMs?: number;
  steps?: DebugStep[];
};

/** A statement and the values it is given. */
export type Query = { text: string; values: unknown[] };

export type RunsRequest = { runId?: string; limit: number };

const RUN_COLUMNS =
  'workflow_uuid, name, status, recovery_attempts, ' +
  'created_at, completed_at';

/**
 * The runs to answer with: one named run, or the
 * most recent few.
 *
 * Newest first, because somebody asking what just
 * happened means the run that just happened.
 */
export function runsQuery(request: RunsRequest): Query {
  if (request.runId !== undefined) {
    return {
      text:
        `SELECT ${RUN_COLUMNS} FROM dbos.workflow_status ` +
        'WHERE workflow_uuid = $1',
      values: [request.runId],
    };
  }

  return {
    text:
      `SELECT ${RUN_COLUMNS} FROM dbos.workflow_status ` +
      'ORDER BY created_at DESC LIMIT $1',
    values: [request.limit],
  };
}

/**
 * The steps of one run, in the order DBOS numbered
 * them, which is the order they ran in.
 */
export function stepsQuery(runId: string): Query {
  return {
    text:
      'SELECT function_id, function_name, started_at_epoch_ms, ' +
      'completed_at_epoch_ms, error, child_workflow_id ' +
      'FROM dbos.operation_outputs ' +
      'WHERE workflow_uuid = $1 ORDER BY function_id',
    values: [runId],
  };
}

export function toRun(row: WorkflowStatusRow): DebugRun {
  const startedAtMs = Number(row.created_at);
  const run: DebugRun = {
    workflowId: row.workflow_uuid,
    name: row.name,
    status: row.status,
    recoveryAttempts: Number(row.recovery_attempts),
    startedAt: new Date(startedAtMs).toISOString(),
  };

  if (has(row.completed_at)) {
    run.durationMs = Number(row.completed_at) - startedAtMs;
  }

  return run;
}

export function toStep(row: OperationOutputRow): DebugStep {
  const step: DebugStep = {
    functionID: Number(row.function_id),
    name: row.function_name,
  };

  if (has(row.started_at_epoch_ms)) {
    step.startedAtEpochMs = Number(row.started_at_epoch_ms);
  }
  if (has(row.completed_at_epoch_ms)) {
    step.completedAtEpochMs = Number(row.completed_at_epoch_ms);
  }
  if (has(row.error)) step.error = row.error;
  if (has(row.child_workflow_id)) step.childWorkflowID = row.child_workflow_id;

  return step;
}

/** Whether a nullable column carries a value. */
function has<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
