import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildBundle, versionString, type Bundle } from './bundle.js';
import { TOOLS } from './registry.js';
import {
  makeBareDirectory,
  type Fixture,
} from './test-support/fixture-project.js';

describe('versionString', () => {
  it('names the branch and pins the build to a commit', () => {
    expect(
      versionString({
        branch: 'mcp-server-v0.0.1',
        sha: '3b7ade2f0a1b2c3d4e5f',
        packageVersion: '0.0.0',
      }),
    ).toBe('mcp-server-v0.0.1+3b7ade2');
  });

  it('falls back to the package version without a branch', () => {
    expect(
      versionString({ sha: '3b7ade2f0a1b2c3d4e5f', packageVersion: '0.0.0' }),
    ).toBe('0.0.0+3b7ade2');
  });

  it('is the package version alone when git is unavailable', () => {
    expect(versionString({ packageVersion: '0.0.0' })).toBe('0.0.0');
  });
});

/**
 * The bundle answering for itself, away from
 * everything that built it.
 *
 * A vendored copy has no repository around it and
 * no `node_modules` beside it, so the only way to
 * know it still works is to put it somewhere that
 * has neither and talk to it there. None of what
 * breaks here is visible to an in-process test.
 */
describe('the built bundle', () => {
  const vendored: Fixture[] = [];
  const open: Client[] = [];
  let bundle: Bundle;

  beforeAll(async () => {
    bundle = await buildBundle();
  }, 120_000);

  afterAll(async () => {
    while (open.length > 0) await open.pop()?.close();
    while (vendored.length > 0) vendored.pop()?.cleanup();
  });

  /** A directory holding the bundle and nothing else. */
  function vendor(): string {
    const fixture = makeBareDirectory();
    vendored.push(fixture);

    copyFileSync(bundle.server, join(fixture.dir, 'server.js'));
    copyFileSync(bundle.version, join(fixture.dir, 'VERSION'));

    // Node decides whether a `.js` file is an ES
    // module from the nearest `package.json`, and
    // the bundle is one. A scaffolded project's own
    // says `"type": "module"`, so the directory
    // standing in for one says it too.
    writeFileSync(
      join(fixture.dir, 'package.json'),
      `${JSON.stringify({ type: 'module' })}\n`,
      'utf8',
    );

    return fixture.dir;
  }

  /** A client talking to the copy in `dir`. */
  async function connect(dir: string): Promise<Client> {
    const client = new Client({ name: 'bundle smoke', version: '0.0.0' });
    open.push(client);

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(dir, 'server.js')],
        cwd: dir,
      }),
    );

    return client;
  }

  it('lists every tool it registers from a bare directory', async () => {
    const client = await connect(vendor());

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      TOOLS.map((tool) => tool.name),
    );
  });

  it('reads a resource from a bare directory', async () => {
    const client = await connect(vendor());

    const { contents } = await client.readResource({
      uri: 'mboss://node-catalog',
    });

    const [body] = contents;
    if (body === undefined || !('text' in body)) {
      throw new Error('the read came back with no text');
    }
    expect(body.mimeType).toBe('application/json');
    expect(JSON.parse(body.text)).toHaveProperty('kinds');
  });

  /**
   * Scaffolding a handler type-checks the project's
   * own code-behind, which wants Node's type
   * declarations — and a vendored bundle has none
   * beside it until the project installs its own.
   * That has to be a poorer scan rather than a dead
   * server, and this is where the difference shows.
   */
  it('scaffolds a typed handler with nothing installed', async () => {
    const dir = vendor();
    mkdirSync(join(dir, '.mboss', 'workflows'), { recursive: true });
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(
      join(dir, 'lib', 'types.ts'),
      'export type Booking = { id: string };\n' +
        'export type Slot = { at: string };\n',
      'utf8',
    );
    const client = await connect(dir);

    await client.callTool({
      name: 'workflow_create',
      arguments: { name: 'sample' },
    });
    await client.callTool({
      name: 'workflow_apply_spec',
      arguments: {
        name: 'sample',
        spec: TYPED_DRAFT,
        dryRun: false,
        baseRevision: 1,
      },
    });
    const scaffolded = await client.callTool({
      name: 'workflow_scaffold_step',
      arguments: { workflow: 'sample', nodeId: 'work' },
    });

    expect(scaffolded.structuredContent).toMatchObject({
      created: [
        {
          path: join(dir, 'lib', 'findSlot.ts'),
          export: 'findSlot',
          signature:
            'export async function findSlot(input: Booking): Promise<Slot>',
        },
        { path: join(dir, 'lib', 'findSlot.test.ts') },
      ],
    });
  });

  /**
   * A path baked in at build time would resolve to
   * nothing on the machine that runs the bundle,
   * and the failure would come much later than
   * this.
   */
  it('carries no path from the machine that built it', () => {
    const built = readFileSync(bundle.server, 'utf8');

    expect(built.includes(resolve(import.meta.dirname, '..'))).toBe(false);
  });

  /**
   * The extension compares this against the copy it
   * ships to offer a refresh, so it has to be one
   * unambiguous token — an error message from git
   * would have spaces in it.
   */
  it('ships a VERSION beside it', () => {
    const version = readFileSync(join(vendor(), 'VERSION'), 'utf8');

    expect(version).toMatch(/^\S+\n$/);
  });
});

/** A workflow with one handler left to write. */
const TYPED_DRAFT = {
  title: 'A sample',
  nodes: [
    {
      id: 'start',
      title: 'Start',
      kind: 'trigger',
      config: { mode: 'manual' },
    },
    {
      id: 'work',
      title: 'Work',
      kind: 'step',
      config: {},
      in: 'Booking',
      out: 'Slot',
      handler: { export: 'findSlot' },
    },
  ],
  edges: [{ id: 'e1', from: { node: 'start' }, to: { node: 'work' } }],
};
