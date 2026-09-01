import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { workflowFile, type Diagnostic } from '@mboss/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RESOURCES, type ResourceDefinition } from './resources.js';
import type { NodeCatalog } from './resources/json-schema.js';
import { coreFixture } from './test-support/core-fixtures.js';
import {
  makeBareDirectory,
  makeFixtureProject,
  type Fixture,
  type ProjectFixture,
} from './test-support/fixture-project.js';

/**
 * The read-only half of the surface, against a
 * real project in a temp directory. What the two
 * schema resources say is checked next door; what
 * is checked here is that each URI answers, that
 * the answers are about this project, and that a
 * read of something missing is an answer rather
 * than a crash.
 */

let fixture: ProjectFixture;
const spare: Fixture[] = [];

beforeEach(() => {
  fixture = makeFixtureProject();
});

afterEach(() => {
  fixture.cleanup();
  while (spare.length > 0) spare.pop()?.cleanup();
});

function resource(uri: string): ResourceDefinition {
  const found = RESOURCES.find((candidate) => candidate.uri === uri);
  if (found === undefined) throw new Error(`no resource at ${uri}`);

  return found;
}

function read(uri: string, cwd: string = fixture.dir): Promise<string> {
  return resource(uri).read(cwd);
}

async function readJson<T>(uri: string, cwd?: string): Promise<T> {
  return JSON.parse(await read(uri, cwd)) as T;
}

/** The code a failed read reports. */
async function codeOf(uri: string, cwd?: string): Promise<unknown> {
  try {
    await read(uri, cwd);
  } catch (error) {
    return JSON.parse((error as Error).message)['code'];
  }

  throw new Error(`${uri} did not fail`);
}

/** Copies a core workflow into the project. */
function addWorkflow(name: string, modifiedAt?: Date): void {
  const path = workflowFile(fixture.mbossDir, name);
  writeFileSync(path, `${JSON.stringify(coreFixture(name), null, 2)}\n`);

  if (modifiedAt !== undefined) utimesSync(path, modifiedAt, modifiedAt);
}

function addLib(file: string, source: string): void {
  mkdirSync(join(fixture.dir, 'lib'), { recursive: true });
  writeFileSync(join(fixture.dir, 'lib', file), source, 'utf8');
}

describe('the resource surface', () => {
  it('offers exactly the five documented URIs', () => {
    expect(RESOURCES.map((entry) => entry.uri)).toEqual([
      'mboss://node-catalog',
      'mboss://workflow-schema',
      'mboss://current-workflow',
      'mboss://diagnostics',
      'mboss://conventions',
    ]);
  });

  it('names every resource after its URI', () => {
    for (const entry of RESOURCES) {
      expect(entry.uri).toBe(`mboss://${entry.name}`);
    }
  });

  it('declares a media type for every resource', () => {
    expect(RESOURCES.map((entry) => entry.mimeType)).toEqual([
      'application/json',
      'application/json',
      'application/json',
      'application/json',
      'text/markdown',
    ]);
  });

  it('describes every resource in one line', () => {
    for (const entry of RESOURCES) {
      expect(entry.title, entry.uri).not.toBe('');
      expect(entry.description, entry.uri).toMatch(/^[^\n]+\.$/);
    }
  });
});

describe('the schema resources', () => {
  /**
   * The catalog is what a kind is, not what this
   * project has, so an agent reading it before
   * there is a project to read is the ordinary
   * case rather than an error.
   */
  it('serve the catalog outside a project', async () => {
    const bare = makeBareDirectory();
    spare.push(bare);

    const catalog = await readJson<NodeCatalog>(
      'mboss://node-catalog',
      bare.dir,
    );

    expect(catalog.kinds).toHaveLength(10);
  });

  it('serve the document schema outside a project', async () => {
    const bare = makeBareDirectory();
    spare.push(bare);

    const schema = await readJson<{ properties?: object }>(
      'mboss://workflow-schema',
      bare.dir,
    );

    expect(Object.keys(schema.properties ?? {})).toContain('nodes');
  });
});

describe('mboss://current-workflow', () => {
  type Current = {
    name: string;
    path: string;
    revision: number;
    ir: { name: string };
    ambiguity?: string;
  };

  it("answers with the project's only workflow", async () => {
    addWorkflow('groom_booking');

    const current = await readJson<Current>('mboss://current-workflow');

    expect(current.name).toBe('groom_booking');
    expect(current.revision).toBe(12);
    expect(current.ir.name).toBe('groom_booking');
    expect(current.path).toBe(workflowFile(fixture.mbossDir, 'groom_booking'));
  });

  it('says nothing about ambiguity when there was none', async () => {
    addWorkflow('groom_booking');

    const current = await readJson<Current>('mboss://current-workflow');

    expect(current.ambiguity).toBeUndefined();
  });

  it('notes that it guessed when it had to', async () => {
    addWorkflow('groom_booking', new Date('2026-01-01T00:00:00Z'));
    addWorkflow('timer_wait', new Date('2026-06-01T00:00:00Z'));

    const current = await readJson<Current>('mboss://current-workflow');

    expect(current.name).toBe('timer_wait');
    expect(current.ambiguity).toContain('timer_wait');
  });

  it('fails with NO_CURRENT_WORKFLOW in an empty project', async () => {
    expect(await codeOf('mboss://current-workflow')).toBe(
      'NO_CURRENT_WORKFLOW',
    );
  });
});

describe('mboss://diagnostics', () => {
  type Report = {
    workflows: Array<{ name: string; diagnostics: Diagnostic[] }>;
    unreadable: Array<{ name: string; reason: string }>;
    manifestErrors: Array<{ file: string; message: string }>;
  };

  it('validates every workflow in the project', async () => {
    addWorkflow('groom_booking');
    addWorkflow('timer_wait');

    const report = await readJson<Report>('mboss://diagnostics');

    expect(report.workflows.map((entry) => entry.name)).toEqual([
      'groom_booking',
      'timer_wait',
    ]);
    expect(report.workflows[0]?.diagnostics.length).toBeGreaterThan(0);
  });

  /**
   * A file that will not parse is the very thing
   * this resource exists to report, so it comes
   * back as a finding rather than taking the other
   * workflows' findings down with it.
   */
  it('reports a workflow it cannot read', async () => {
    addWorkflow('groom_booking');
    writeFileSync(workflowFile(fixture.mbossDir, 'broken'), 'not json');

    const report = await readJson<Report>('mboss://diagnostics');

    expect(report.workflows.map((entry) => entry.name)).toEqual([
      'groom_booking',
    ]);
    expect(report.unreadable.map((entry) => entry.name)).toEqual(['broken']);
    expect(report.unreadable[0]?.reason).not.toBe('');
  });

  it('carries what the code-behind scan found', async () => {
    addLib(
      'handlers.ts',
      'export function no(): number {\n  return true;\n}\n',
    );

    const report = await readJson<Report>('mboss://diagnostics');

    expect(report.manifestErrors.length).toBeGreaterThan(0);
    expect(report.manifestErrors[0]?.file).toContain('handlers.ts');
  });

  it('is empty rather than absent in a project with nothing in it', async () => {
    const report = await readJson<Report>('mboss://diagnostics');

    expect(report).toEqual({
      workflows: [],
      unreadable: [],
      manifestErrors: [],
    });
  });
});

describe('mboss://conventions', () => {
  it("serves the project's conventions", async () => {
    writeFileSync(
      join(fixture.mbossDir, 'conventions.md'),
      '# Conventions\n\nHandlers go in `lib/`.\n',
      'utf8',
    );

    expect(await read('mboss://conventions')).toContain('Handlers go in');
  });

  /**
   * A project made by hand has no conventions file
   * and is not broken for it — an agent reading
   * this before writing code should be told there
   * is nothing to follow, not handed an error.
   */
  it('is empty when the project has none', async () => {
    expect(await read('mboss://conventions')).toBe('');
  });
});

describe('a resource that reads the project', () => {
  it('fails with NOT_AN_MBOSS_PROJECT outside one', async () => {
    const bare = makeBareDirectory();
    spare.push(bare);

    for (const uri of [
      'mboss://current-workflow',
      'mboss://diagnostics',
      'mboss://conventions',
    ]) {
      expect(await codeOf(uri, bare.dir), uri).toBe('NOT_AN_MBOSS_PROJECT');
    }
  });
});
