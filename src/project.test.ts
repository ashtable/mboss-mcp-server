import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveProject } from './project.js';
import {
  makeBareDirectory,
  makeFixtureProject,
  type Fixture,
} from './test-support/fixture-project.js';

describe('resolveProject', () => {
  const fixtures: Fixture[] = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.cleanup();
  });

  function project(): string {
    const fixture = makeFixtureProject();
    fixtures.push(fixture);

    return fixture.dir;
  }

  function bare(): string {
    const fixture = makeBareDirectory();
    fixtures.push(fixture);

    return fixture.dir;
  }

  it('finds .mboss/ in the given directory', () => {
    const dir = project();

    const outcome = resolveProject(dir);

    expect(outcome).toEqual({
      ok: true,
      project: { projectDir: dir, mbossDir: join(dir, '.mboss') },
    });
  });

  it('walks up to a parent that holds .mboss/', () => {
    const dir = project();
    const nested = join(dir, 'lib', 'handlers');
    mkdirSync(nested, { recursive: true });

    const outcome = resolveProject(nested);

    expect(outcome).toEqual({
      ok: true,
      project: { projectDir: dir, mbossDir: join(dir, '.mboss') },
    });
  });

  it('fails with NOT_AN_MBOSS_PROJECT outside a project', () => {
    const dir = bare();

    const outcome = resolveProject(dir);

    expect(outcome).toEqual({
      ok: false,
      error: { code: 'NOT_AN_MBOSS_PROJECT', path: dir },
    });
  });
});
