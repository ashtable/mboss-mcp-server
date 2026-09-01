import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How this project writes its code-behind.
 *
 * The file is scaffolded and then belongs to the
 * project, so an agent reads it before writing
 * anything in `lib/`. Core names the same file in
 * a path helper its barrel does not export, so the
 * name is written here as well.
 */
const CONVENTIONS_FILE = 'conventions.md';

/**
 * A project made by hand has no conventions file
 * and is not broken for it: there is simply
 * nothing to follow, which is an answer rather
 * than a failure.
 */
export function readConventions(mbossDir: string): string {
  try {
    return readFileSync(join(mbossDir, CONVENTIONS_FILE), 'utf8');
  } catch {
    return '';
  }
}
