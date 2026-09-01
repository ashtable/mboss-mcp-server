import { describe, expect, it } from 'vitest';

import { TOOLS } from './registry.js';

/**
 * The whole tool surface, written down so that
 * neither a name invented in passing nor a tool
 * quietly dropped can go unnoticed. The count is a
 * product fact — the shipped skill lists these
 * eleven and a test in this repo checks that it
 * still does — so it is pinned rather than
 * derived.
 */
const THE_TOOL_SURFACE = [
  'project_build',
  'project_debug',
  'project_deploy',
  'project_test',
  'workflow_apply_spec',
  'workflow_create',
  'workflow_delete_node',
  'workflow_get',
  'workflow_rename_node',
  'workflow_scaffold_step',
  'workflow_validate',
];

describe('the tool registry', () => {
  it('names every tool in underscore form', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('gives every tool a dotted title', () => {
    for (const tool of TOOLS) {
      expect(tool.title).toBe(tool.name.replace('_', '.'));
    }
  });

  it('describes every tool in one line', () => {
    for (const tool of TOOLS) {
      expect(tool.description).not.toBe('');
      expect(tool.description).not.toContain('\n');
      expect(tool.description.endsWith('.')).toBe(true);
    }
  });

  it('registers exactly the eleven tools', () => {
    expect(THE_TOOL_SURFACE).toHaveLength(11);
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual(THE_TOOL_SURFACE);
  });

  it('has no duplicate names', () => {
    const names = TOOLS.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
