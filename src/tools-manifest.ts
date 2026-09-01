import { resolve } from 'node:path';

import type { ToolDefinition } from './registry.js';

/**
 * The checked-in manifest, generated from the
 * registry.
 *
 * It exists so that anything outside this repo
 * can read the tool surface without loading the
 * server: the shipped skill's tool reference is
 * written against it, and a test compares the two.
 */
export const MANIFEST_PATH = resolve(
  import.meta.dirname,
  '..',
  'tools.manifest.json',
);

type ManifestEntry = {
  name: string;
  title: string;
  description: string;
};

/**
 * Renders the manifest as the text to write.
 *
 * Nothing about a run leaks in — no clock, no
 * host path, and tools sorted by name rather than
 * by registration order — because a generated
 * file that differs between two runs cannot be
 * the thing a drift check compares against.
 *
 * Sorting is by code unit rather than by locale:
 * the comparison happens on whichever machine
 * runs CI, and `localeCompare` is not the same
 * everywhere.
 */
export function renderToolsManifest(tools: readonly ToolDefinition[]): string {
  const entries: ManifestEntry[] = tools
    .map(({ name, title, description }) => ({ name, title, description }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return `${JSON.stringify({ tools: entries }, null, 2)}\n`;
}
