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
const SYSTEM_URL = 'postgres://postgres:mboss@127.0.0.1:5434/fixture_dbos';

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

  /**
   * The ledger is the DBOS system database, and a
   * project that keeps it apart from the app's own
   * says so under its own name. The editor reads
   * the same two names in the same order over the
   * same file, so a person reading a run there and
   * a tool reading it here land on one database.
   */
  it('prefers DBOS_SYSTEM_DATABASE_URL when the file sets both', () => {
    writeEnv(
      [
        `DATABASE_URL=${URL}`,
        `DBOS_SYSTEM_DATABASE_URL=${SYSTEM_URL}`,
        '',
      ].join('\n'),
    );

    expect(readDatabaseUrl(fixture.dir)).toBe(SYSTEM_URL);
  });

  it('reads DATABASE_URL when it is the only one set', () => {
    writeEnv(`DATABASE_URL=${URL}\n`);

    expect(readDatabaseUrl(fixture.dir)).toBe(URL);
  });

  /**
   * A name set to nothing is a name that is not
   * set. Without this the winner of an empty first
   * name would be an empty connection string.
   */
  it('passes over the first name when it is set to nothing', () => {
    writeEnv(
      ['DBOS_SYSTEM_DATABASE_URL=', `DATABASE_URL=${URL}`, ''].join('\n'),
    );

    expect(readDatabaseUrl(fixture.dir)).toBe(URL);
  });

  it('names the file and both names when it sets neither', () => {
    writeEnv('APP_BASE_URL=http://127.0.0.1:3200\n');

    expect(() => readDatabaseUrl(fixture.dir)).toThrow(/\.env/);
    expect(() => readDatabaseUrl(fixture.dir)).toThrow(
      /sets neither DBOS_SYSTEM_DATABASE_URL nor DATABASE_URL\./,
    );
  });

  it('names the file when there is none', () => {
    expect(() => readDatabaseUrl(fixture.dir)).toThrow(/\.env/);
  });
});
