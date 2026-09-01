import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeBareDirectory,
  type Fixture,
} from '../test-support/fixture-project.js';

import { readDatabaseUrl } from './client.js';

/**
 * Finding the database a project talks to.
 *
 * Only the reading is tested here. Connecting is
 * proved against a real generated app in the
 * end-to-end suite, which is the first place in
 * the plan a DBOS-created schema exists at all.
 */

const URL = 'postgres://postgres:mboss@127.0.0.1:5434/fixture';

let fixture: Fixture;

beforeEach(() => {
  fixture = makeBareDirectory();
});

afterEach(() => {
  fixture.cleanup();
});

function writeEnv(contents: string): void {
  writeFileSync(join(fixture.dir, '.env'), contents, 'utf8');
}

describe('readDatabaseUrl', () => {
  it("reads DATABASE_URL from the project's .env", () => {
    writeEnv(`DATABASE_URL=${URL}\n`);

    expect(readDatabaseUrl(fixture.dir)).toBe(URL);
  });

  it('ignores comments, blank lines and other settings', () => {
    writeEnv(
      [
        '# The app and DBOS share one database.',
        '',
        'APP_BASE_URL=http://127.0.0.1:3200',
        `DATABASE_URL=${URL}`,
        'EVENTS_SECRET=not-the-one-being-read',
        '',
      ].join('\n'),
    );

    expect(readDatabaseUrl(fixture.dir)).toBe(URL);
  });

  it('strips quotes around the value', () => {
    writeEnv(`DATABASE_URL="${URL}"\n`);

    expect(readDatabaseUrl(fixture.dir)).toBe(URL);
  });

  it('reads a value the file exports', () => {
    writeEnv(`export DATABASE_URL=${URL}\n`);

    expect(readDatabaseUrl(fixture.dir)).toBe(URL);
  });

  it('names the file when it holds no DATABASE_URL', () => {
    writeEnv('APP_BASE_URL=http://127.0.0.1:3200\n');

    expect(() => readDatabaseUrl(fixture.dir)).toThrow(/\.env/);
    expect(() => readDatabaseUrl(fixture.dir)).toThrow(/DATABASE_URL/);
  });

  it('names the file when there is none', () => {
    expect(() => readDatabaseUrl(fixture.dir)).toThrow(/\.env/);
  });
});
