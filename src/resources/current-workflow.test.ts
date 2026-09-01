import { utimesSync, writeFileSync } from 'node:fs';

import { stateFile, workflowFile } from '@mboss/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  makeFixtureProject,
  type Fixture,
} from '../test-support/fixture-project.js';

import { resolveCurrentWorkflow } from './current-workflow.js';

const fixtures: Fixture[] = [];

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.cleanup();
});

function project(): string {
  const fixture = makeFixtureProject();
  fixtures.push(fixture);

  return fixture.mbossDir;
}

/**
 * A workflow file with nothing in it that this
 * resolver reads — it only ever looks at names and
 * modification times.
 */
function addWorkflow(mbossDir: string, name: string, modifiedAt?: Date): void {
  const path = workflowFile(mbossDir, name);
  writeFileSync(path, '{}\n', 'utf8');

  if (modifiedAt !== undefined) utimesSync(path, modifiedAt, modifiedAt);
}

function setActive(mbossDir: string, activeWorkflow: string): void {
  writeFileSync(stateFile(mbossDir), JSON.stringify({ activeWorkflow }));
}

describe('resolveCurrentWorkflow', () => {
  it('prefers the active workflow the editor wrote down', () => {
    const mbossDir = project();
    addWorkflow(mbossDir, 'first');
    addWorkflow(mbossDir, 'second');
    setActive(mbossDir, 'second');

    const outcome = resolveCurrentWorkflow(mbossDir);

    expect(outcome).toEqual({ ok: true, current: { name: 'second' } });
  });

  it('falls back to the only workflow', () => {
    const mbossDir = project();
    addWorkflow(mbossDir, 'only_one');

    const outcome = resolveCurrentWorkflow(mbossDir);

    expect(outcome).toEqual({ ok: true, current: { name: 'only_one' } });
  });

  it('falls back to the most recently changed, and says it guessed', () => {
    const mbossDir = project();
    addWorkflow(mbossDir, 'older', new Date('2026-01-01T00:00:00Z'));
    addWorkflow(mbossDir, 'newer', new Date('2026-06-01T00:00:00Z'));

    const outcome = resolveCurrentWorkflow(mbossDir);
    if (!outcome.ok) throw new Error(outcome.error.code);

    expect(outcome.current.name).toBe('newer');
    expect(outcome.current.ambiguity).toContain('newer');
  });

  it('says nothing about ambiguity when there was none', () => {
    const mbossDir = project();
    addWorkflow(mbossDir, 'only_one');

    const outcome = resolveCurrentWorkflow(mbossDir);
    if (!outcome.ok) throw new Error(outcome.error.code);

    expect(outcome.current.ambiguity).toBeUndefined();
  });

  it('ignores an active workflow that is gone', () => {
    const mbossDir = project();
    addWorkflow(mbossDir, 'still_here');
    setActive(mbossDir, 'deleted_since');

    const outcome = resolveCurrentWorkflow(mbossDir);

    expect(outcome).toEqual({ ok: true, current: { name: 'still_here' } });
  });

  it('ignores a hint file it cannot read', () => {
    const mbossDir = project();
    addWorkflow(mbossDir, 'still_here');
    writeFileSync(stateFile(mbossDir), 'not json at all');

    const outcome = resolveCurrentWorkflow(mbossDir);

    expect(outcome).toEqual({ ok: true, current: { name: 'still_here' } });
  });

  it('fails with NO_CURRENT_WORKFLOW when there are none', () => {
    const outcome = resolveCurrentWorkflow(project());

    expect(outcome).toEqual({
      ok: false,
      error: { code: 'NO_CURRENT_WORKFLOW' },
    });
  });
});
