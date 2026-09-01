// Deliberately not `node:module`: inside the
// bundle this file stands in for that specifier,
// and esbuild matches it exactly, so reaching for
// the real one has to spell it the other way.
import { createRequire as nodeCreateRequire } from 'module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `node:module` as a vendored bundle needs it.
 *
 * `createRequire` is the only thing anything in the
 * bundle asks this module for. Should that change,
 * esbuild refuses the build for the missing export
 * rather than quietly shipping a hole, which is the
 * moment to add it here.
 *
 * A library that wants Node's type declarations for
 * a type-check takes them from beside itself, which
 * is right everywhere but here: a vendored bundle
 * sits beside the project it serves, not beside its
 * own dependencies, and a project that has not
 * installed anything yet has none to offer either.
 *
 * That resolution failing must not stop the server
 * from starting — a scan without Node's globals is
 * a poorer answer, not a broken one — so a type
 * package that cannot be found resolves to where it
 * would have been and the type-checker carries on
 * without it. Every other specifier still throws:
 * a missing runtime module is a real failure.
 */
export function createRequire(
  filename: string | URL,
): ReturnType<typeof nodeCreateRequire> {
  const required = nodeCreateRequire(filename);
  const resolve = required.resolve;

  required.resolve = Object.assign(
    (id: string, options?: { paths?: string[] }) => {
      try {
        return resolve(id, options);
      } catch (failure) {
        if (!id.startsWith('@types/')) throw failure;

        return join(dirname(pathOf(filename)), 'node_modules', id);
      }
    },
    { paths: resolve.paths },
  );

  return required;
}

/** `createRequire` takes a path or a file URL. */
function pathOf(filename: string | URL): string {
  return typeof filename === 'string' && !filename.startsWith('file:')
    ? filename
    : fileURLToPath(filename);
}
