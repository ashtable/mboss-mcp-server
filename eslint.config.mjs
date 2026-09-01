import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * This repo imports the bare `@mboss/core`
 * barrel, unlike the cloud services, which fence
 * themselves to two subpaths. It needs the IR,
 * validation, apply, manifest and compile modules
 * together, so elkjs and ts-morph are weight it
 * pays on purpose rather than baggage to keep
 * out.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      // Nested submodules lint in their own repos.
      'mboss-core/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier, // last — turns off rules that fight Prettier
);
