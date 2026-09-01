import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

/**
 * The connection `project_debug` reads through.
 *
 * A pool opened for one tool call and closed
 * again: this server does not run alongside the
 * app it is looking at, calls are occasional, and
 * a connection held open across them would keep a
 * slot on somebody's development database for as
 * long as their editor was running.
 */

/** Where a read goes, and how to stop reading. */
export type Database = {
  query<R>(text: string, values: unknown[]): Promise<R[]>;
  close(): Promise<void>;
};

export type OpenDatabase = (projectDir: string) => Promise<Database>;

/**
 * The database a project's app talks to.
 *
 * Read from the project's own `.env` rather than
 * from this process's environment: the answer has
 * to be the app's database, and an agent's shell
 * has no reason to be holding it.
 *
 * A tiny parser rather than a dotenv dependency.
 * One file, one variable, and this server is
 * bundled into every project that uses it.
 */
export function readDatabaseUrl(projectDir: string): string {
  const path = join(projectDir, '.env');

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `${path} is not readable, so there is no database to look in. ` +
        'A scaffolded project writes one; copy `.env.example` if it is ' +
        'missing.',
    );
  }

  const url = valueOf(contents, 'DATABASE_URL');
  if (url === undefined) {
    throw new Error(`${path} sets no DATABASE_URL.`);
  }

  return url;
}

/**
 * Opens a read-only look at the project's
 * database.
 *
 * `max: 1` because both statements run one after
 * the other and nothing else shares this pool.
 */
export const openProjectDatabase: OpenDatabase = async (projectDir) => {
  const pool = new pg.Pool({
    connectionString: readDatabaseUrl(projectDir),
    max: 1,
  });

  return {
    query: async <R>(text: string, values: unknown[]) => {
      const { rows } = await pool.query(text, values);

      return rows as R[];
    },
    close: () => pool.end(),
  };
};

/**
 * The last value a `.env` gives a name, or
 * `undefined`.
 *
 * Last rather than first, because that is what
 * every tool that reads these files does with a
 * repeated name.
 */
function valueOf(contents: string, name: string): string | undefined {
  let found: string | undefined;

  for (const raw of contents.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;

    const at = line.indexOf('=');
    if (at === -1 || line.slice(0, at).trim() !== name) continue;

    found = unquote(line.slice(at + 1).trim());
  }

  return found;
}

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    (value.startsWith('"') || value.startsWith("'")) &&
    value.endsWith(value[0] ?? '');

  return quoted ? value.slice(1, -1) : value;
}
