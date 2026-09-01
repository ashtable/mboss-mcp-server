import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRequire } from './vendored-node-module.js';

/**
 * This stands in for `node:module` only inside the
 * bundle, so it is exercised here directly. What it
 * changes is narrow and the boundary is the whole
 * point: type declarations may be absent, runtime
 * modules may not.
 */
describe('createRequire', () => {
  const required = createRequire(import.meta.url);

  it('resolves a package that is installed', () => {
    expect(required.resolve('@types/node/package.json')).toContain(
      join('node_modules', '@types', 'node'),
    );
  });

  it('answers with where a missing type package would have been', () => {
    expect(required.resolve('@types/nothing/package.json')).toBe(
      join(import.meta.dirname, 'node_modules', '@types/nothing/package.json'),
    );
  });

  it('still refuses a missing runtime module', () => {
    expect(() => required.resolve('nothing-is-installed-here')).toThrow(
      /Cannot find module/,
    );
  });

  it('keeps the search paths the real one exposes', () => {
    expect(required.resolve.paths('vitest')).toEqual(
      expect.arrayContaining([join(import.meta.dirname, 'node_modules')]),
    );
  });
});
