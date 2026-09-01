import { describe, expect, it } from 'vitest';

import {
  MAX_RUNS,
  runsQuery,
  stepsQuery,
  toRun,
  toStep,
  type OperationOutputRow,
  type WorkflowStatusRow,
} from './queries.js';

/**
 * The `pg` layer, with no database anywhere near
 * it.
 *
 * DBOS owns the schema these queries read, so the
 * column names here are knowledge this repo keeps
 * by hand. The mappers are therefore tested
 * against rows written out the way DBOS's own
 * types say it stores them, and the queries are
 * tested for being reads and nothing else. What
 * neither can prove — that the columns are really
 * called this — is asserted against a running
 * generated app in the end-to-end suite.
 */

/** A run that finished, with every column set. */
const FINISHED: WorkflowStatusRow = {
  workflow_uuid: 'wf-1',
  name: 'groom_booking',
  status: 'SUCCESS',
  // `pg` hands back a bigint as text.
  recovery_attempts: '2',
  created_at: '1756684800000',
  completed_at: '1756684802500',
};

/** A step that finished, with every column set. */
const STEP: OperationOutputRow = {
  function_id: 3,
  function_name: 'findSlot',
  started_at_epoch_ms: '1756684800100',
  completed_at_epoch_ms: '1756684800400',
  error: null,
  child_workflow_id: null,
};

const WRITES = /\b(insert|update|delete|create|drop|alter|truncate)\b/i;

describe('the debug queries', () => {
  it('reads only workflow_status and operation_outputs', () => {
    const texts = [
      runsQuery({ limit: 10 }).text,
      runsQuery({ runId: 'wf-1', limit: 10 }).text,
      stepsQuery('wf-1').text,
    ];

    expect(texts.join('\n')).toContain('dbos.workflow_status');
    expect(texts.join('\n')).toContain('dbos.operation_outputs');

    for (const text of texts) {
      expect(text).not.toMatch(WRITES);
    }
  });

  it('parameterises the run id', () => {
    const runs = runsQuery({ runId: "wf-1'; DROP TABLE x --", limit: 10 });
    const steps = stepsQuery("wf-1'; DROP TABLE x --");

    expect(runs.text).not.toContain('wf-1');
    expect(runs.values).toEqual(["wf-1'; DROP TABLE x --"]);
    expect(steps.text).not.toContain('wf-1');
    expect(steps.values).toEqual(["wf-1'; DROP TABLE x --"]);
  });

  it('passes the limit as a parameter, never as text', () => {
    const query = runsQuery({ limit: MAX_RUNS });

    expect(query.text).not.toContain(String(MAX_RUNS));
    expect(query.values).toEqual([MAX_RUNS]);
  });

  it('caps a listing at fifty runs', () => {
    // The tool's input schema is built from this
    // constant, so the cap is written down once.
    expect(MAX_RUNS).toBe(50);
  });
});

describe('toRun', () => {
  it('maps every column to its output field', () => {
    expect(toRun(FINISHED)).toEqual({
      workflowId: 'wf-1',
      name: 'groom_booking',
      status: 'SUCCESS',
      recoveryAttempts: 2,
      startedAt: '2025-09-01T00:00:00.000Z',
      durationMs: 2500,
    });
  });

  it('reads a bigint column that arrives as a number', () => {
    const run = toRun({
      ...FINISHED,
      recovery_attempts: 2,
      created_at: 1756684800000,
      completed_at: 1756684802500,
    });

    expect(run).toEqual(toRun(FINISHED));
  });

  it('leaves durationMs undefined while the run is unfinished', () => {
    const run = toRun({ ...FINISHED, status: 'PENDING', completed_at: null });

    expect(run.durationMs).toBeUndefined();
    expect(Object.keys(run)).not.toContain('durationMs');
  });
});

describe('toStep', () => {
  it('maps every column to its output field', () => {
    expect(
      toStep({
        ...STEP,
        error: 'boom',
        child_workflow_id: 'wf-2',
      }),
    ).toEqual({
      functionID: 3,
      name: 'findSlot',
      startedAtEpochMs: 1756684800100,
      completedAtEpochMs: 1756684800400,
      error: 'boom',
      childWorkflowID: 'wf-2',
    });
  });

  it('carries no per-step attempt count', () => {
    // DBOS counts recovery attempts per run, on
    // `workflow_status`, and records nothing per
    // step. A step row that reported one would be
    // inventing it.
    const step = toStep({
      ...STEP,
      error: 'boom',
      child_workflow_id: 'wf-2',
    });

    expect(Object.keys(step)).toEqual([
      'functionID',
      'name',
      'startedAtEpochMs',
      'completedAtEpochMs',
      'error',
      'childWorkflowID',
    ]);
  });

  it('leaves out the columns a step has nothing in', () => {
    const step = toStep(STEP);

    expect(Object.keys(step)).toEqual([
      'functionID',
      'name',
      'startedAtEpochMs',
      'completedAtEpochMs',
    ]);
  });

  it('reads a step that has not finished', () => {
    const step = toStep({
      ...STEP,
      started_at_epoch_ms: '1756684800100',
      completed_at_epoch_ms: null,
    });

    expect(step.startedAtEpochMs).toBe(1756684800100);
    expect(step.completedAtEpochMs).toBeUndefined();
  });
});
