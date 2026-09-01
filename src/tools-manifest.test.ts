import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TOOLS, type ToolDefinition } from './registry.js';
import { expectGolden } from './test-support/golden.js';
import { MANIFEST_PATH, renderToolsManifest } from './tools-manifest.js';

/**
 * A registry entry with nothing in it but the
 * three fields the manifest renders.
 */
function fakeTool(name: string): ToolDefinition {
  return {
    name,
    title: name.replace('_', '.'),
    description: `Does ${name}.`,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    run: () => Promise.reject(new Error('not called')),
  };
}

describe('tools.manifest.json', () => {
  it('matches the registry', () => {
    expectGolden(MANIFEST_PATH, renderToolsManifest(TOOLS));
  });

  it('is stable across runs', () => {
    expect(renderToolsManifest(TOOLS)).toBe(renderToolsManifest(TOOLS));
  });

  it('carries no timestamp and no host path', () => {
    const manifest = readFileSync(MANIFEST_PATH, 'utf8');

    expect(manifest).not.toContain(resolve(import.meta.dirname, '..'));
    expect(manifest).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('sorts tools by name', () => {
    const rendered = renderToolsManifest([
      fakeTool('workflow_get'),
      fakeTool('project_build'),
    ]);

    expect(JSON.parse(rendered)).toEqual({
      tools: [
        {
          name: 'project_build',
          title: 'project.build',
          description: 'Does project_build.',
        },
        {
          name: 'workflow_get',
          title: 'workflow.get',
          description: 'Does workflow_get.',
        },
      ],
    });
  });
});
