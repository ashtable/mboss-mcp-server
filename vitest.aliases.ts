import { fileURLToPath } from 'node:url';

/**
 * Vitest resolves neither tsconfig `paths` nor a
 * package `main` field, so the nested submodule
 * alias is restated here. Keep it in step with
 * tsconfig.json's `paths`.
 */
export const aliases = {
  '@mboss/core': fileURLToPath(
    new URL('./mboss-core/src/index.ts', import.meta.url),
  ),
};
