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
const CORE_FIXTURES = resolve(
  import.meta.dirname,
  '..',
  'mboss-core',
  'fixtures',
  'ir',
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
});

/**
 * The documents the skill teaches by, held against
 * the fixtures core compiles.
 *
 * This repository is the only one nesting both
 * mboss-core and mboss-skills, so it is the only
 * place these copies can be compared at all. Each
 * example names the fixture it was taken from, and
 * a fixture file carries a trailing newline a
 * fenced block cannot represent — that one byte is
 * the only normalization allowed here.
 */
describe('the worked IR examples', () => {
  const examples = [
    ...readFileSync(IR_EXAMPLES_PATH, 'utf8').matchAll(
      /```json\n([\s\S]*?)\n```/g,
    ),
  ].map((match) => {
    const document = match[1]!;

    return { document, name: (JSON.parse(document) as { name: string }).name };
  });

  it('teach by more than one document', () => {
    expect(examples.length).toBeGreaterThan(1);
  });

  it.each(examples)(
    "embed core's $name fixture byte for byte",
    ({ document, name }) => {
      const fixture = readFileSync(
        resolve(CORE_FIXTURES, `${name}.workflow.json`),
        'utf8',
      );

      expect(document).toBe(fixture.replace(/\n$/, ''));
    },
  );
});
