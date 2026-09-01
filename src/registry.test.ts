import { describe, expect, it } from 'vitest';

import { TOOLS } from './registry.js';

/**
 * The whole tool surface, written down so a name
 * invented in passing cannot slip into the
 * registry. The workflow tools and the project
 * tools arrive in separate commits, so what is
 * asserted below is that nothing outside this
 * list is registered — the list fills in as they
 * land.
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

  it('registers no tool outside the eleven-tool surface', () => {
    expect(THE_TOOL_SURFACE).toHaveLength(11);
    for (const tool of TOOLS) {
      expect(THE_TOOL_SURFACE).toContain(tool.name);
    }
  });

  it('has no duplicate names', () => {
    const names = TOOLS.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
