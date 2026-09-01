import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { TOOLS } from './registry.js';
import { MANIFEST_PATH } from './tools-manifest.js';

/**
 * The tool surface changes here first, so this is
 * where drift against the shipped skill is caught.
 * Everything below reads the nested skill's files
 * off disk and checks them against the live
 * registry — never the other way around, and never
 * a hardcoded tool list of its own.
 */
const SKILLS_ROOT = resolve(
  import.meta.dirname,
  '..',
  'mboss-skills',
  'skills',
  'mboss',
);
const SKILL_PATH = resolve(SKILLS_ROOT, 'SKILL.md');
const TOOLS_REFERENCE_PATH = resolve(SKILLS_ROOT, 'references', 'tools.md');
const IR_EXAMPLES_PATH = resolve(SKILLS_ROOT, 'references', 'ir-examples.md');
const CORE_FIXTURE_PATH = resolve(
  import.meta.dirname,
  '..',
  'mboss-core',
  'fixtures',
  'ir',
  'groom_booking.workflow.json',
);

/**
 * Pulls the frontmatter block out of a SKILL.md
 * file and parses it as YAML. Good enough for this
 * one check — a full frontmatter/body split lives
 * in mboss-skills itself, which this test does not
 * import.
 */
function frontmatterOf(skillText: string): Record<string, unknown> {
  const lines = skillText.split('\n');
  const closeAt = lines.indexOf('---', 1);

  return parseYaml(lines.slice(1, closeAt).join('\n')) as Record<
    string,
    unknown
  >;
}

describe('the skill matches the tool surface', () => {
  const registryNames = TOOLS.map((tool) => tool.name);
  const frontmatter = frontmatterOf(readFileSync(SKILL_PATH, 'utf8'));
  const metadata = frontmatter['metadata'] as Record<string, unknown>;
  const metadataTools = (metadata['mboss-tools'] as string).split(',');
  const allowedTools = (frontmatter['allowed-tools'] as string)
    .split(',')
    .map((entry) => entry.trim());

  const toolsReferenceText = readFileSync(TOOLS_REFERENCE_PATH, 'utf8');
  const headings = [...toolsReferenceText.matchAll(/^### `([a-z_]+)`$/gm)].map(
    (match) => match[1]!,
  );
  const sections = toolsReferenceText.split(/^### `[a-z_]+`$/m).slice(1);

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    tools: { name: string; description: string }[];
  };
  const manifestDescriptions = new Map(
    manifest.tools.map((tool) => [tool.name, tool.description]),
  );

  it('lists every registered tool in metadata.mboss-tools', () => {
    for (const name of registryNames) {
      expect(metadataTools).toContain(name);
    }
  });

  it('registers every tool the skill claims', () => {
    for (const name of metadataTools) {
      expect(registryNames).toContain(name);
    }
  });

  it('lists every registered tool in allowed-tools, mcp-prefixed', () => {
    expect(allowedTools).toEqual(
      registryNames.map((name) => `mcp__mboss__${name}`),
    );
  });

  it('documents every registered tool in references/tools.md', () => {
    expect(headings).toEqual(registryNames);
  });

  it('uses the manifest description verbatim in references/tools.md', () => {
    headings.forEach((name, index) => {
      const description = sections[index]?.trim().split('\n')[0]?.trim();

      expect(description).toBe(manifestDescriptions.get(name));
    });
  });

  // This repo is the only one nesting both mboss-core
  // and mboss-skills, so it is the only place this
  // copy can be checked at all. The fixture file
  // carries a trailing newline that a fenced block
  // cannot represent, so that one byte is the only
  // normalization allowed here.
  it("embeds core's groom_booking fixture byte for byte", () => {
    const irExamplesText = readFileSync(IR_EXAMPLES_PATH, 'utf8');
    const embedded = irExamplesText.match(/```json\n([\s\S]*?)\n```/)?.[1];
    const coreFixture = readFileSync(CORE_FIXTURE_PATH, 'utf8');

    expect(embedded).toBe(coreFixture.replace(/\n$/, ''));
  });
});
