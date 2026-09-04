import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  VERSION_NAME_FILE,
  buildBundle,
  bundleVersion,
  versionName,
  versionString,
  type Bundle,
} from './bundle.js';
import { TOOLS } from './registry.js';
import {
  makeBareDirectory,
  type Fixture,
} from './test-support/fixture-project.js';

/** This checkout, which is what a build stamps. */
const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('versionString', () => {
  it('names the branch and pins the build to a commit', () => {
    expect(
      versionString({
        name: 'mcp-server-v0.0.1',
        sha: '3b7ade2f0a1b2c3d4e5f',
      }),
    ).toBe('mcp-server-v0.0.1+3b7ade2');
  });

  it('is the name alone when git is unavailable', () => {
    expect(versionString({ name: 'mcp-server-v0.0.1' })).toBe(
      'mcp-server-v0.0.1',
    );
  });
});

/**
 * The name in the file, and the one thing that can
 * go wrong with it.
 *
 * A tracked file is read the same way from every
 * checkout, which is the point of it — but it is
 * also a thing a person updates, and the one moment
 * they must is a release cutting the next branch.
 * So the file is held against the branch whenever
 * there is a branch to hold it against.
 */
describe('the version branch this checkout records', () => {
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();

  it('is a version branch of this repository', () => {
    expect(versionName(REPO_ROOT)).toMatch(/^mcp-server-v\d+\.\d+\.\d+$/);
  });

  // Detached — a submodule, or a pull request build
  // — has no branch to disagree with.
  it.skipIf(!/^mcp-server-v/.test(branch))(
    'is the branch the checkout is on',
    () => {
      expect(versionName(REPO_ROOT)).toBe(branch);
    },
  );

  it('refuses a name belonging to another repository', () => {
    const dir = makeBareDirectory().dir;

    writeFileSync(join(dir, VERSION_NAME_FILE), 'vscode-v0.0.1\n', 'utf8');

    expect(() => versionName(dir)).toThrow('vscode-v0.0.1');
  });
});

/**
 * What a checkout that cannot see its own branch
 * calls itself.
 *
 * This is every build of this repository that
 * matters. A submodule is detached the moment it is
 * checked out, so the branch reads back as `HEAD`,
 * and the one place a name was then looked for —
 * the environment — belongs to whichever repository
 * the build is running for. The extension that
 * ships this bundle compares the stamp for exact
 * equality against what a project has vendored, so
 * a stamp that changes with the surroundings is a
 * false "your copy is out of date" offered to
 * somebody whose copy is fine.
 *
 * A detached worktree is that state, made on
 * purpose and reachable from here.
 */
describe('the version a detached checkout stamps', () => {
  const worktrees: string[] = [];

  afterAll(() => {
    vi.unstubAllEnvs();

    while (worktrees.length > 0) {
      execFileSync('git', ['worktree', 'remove', '--force', worktrees.pop()!], {
        cwd: REPO_ROOT,
        stdio: 'ignore',
      });
    }
  });

  /** A second checkout of this commit, with no
   *  branch on it. */
  function detached(): string {
    const dir = join(makeBareDirectory().dir, 'detached');

    execFileSync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    worktrees.push(dir);

    return dir;
  }

  it('names this repository, not the one building it', () => {
    vi.stubEnv('GITHUB_HEAD_REF', 'vscode-v0.0.0');

    expect(bundleVersion(detached())).toMatch(
      /^mcp-server-v\d+\.\d+\.\d+\+[0-9a-f]{7}$/,
    );
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
   * Renaming and deleting a node are core's edits
   * now, not this repository's, so what a caller
   * sees of them is the one thing the swap could
   * have changed. The answer lives in the shipped
   * file, so the question is put to it — over
   * stdio, by a client that knows only the tools.
   */
  it('renames and deletes a node from a real client', async () => {
    const dir = vendor();
    mkdirSync(join(dir, '.mboss', 'workflows'), { recursive: true });
    const client = await connect(dir);

    await client.callTool({
      name: 'workflow_create',
      arguments: { name: 'sample' },
    });
    await client.callTool({
      name: 'workflow_apply_spec',
      arguments: {
        name: 'sample',
        spec: THREE_BLOCK_DRAFT,
        dryRun: false,
        baseRevision: 1,
      },
    });

    const renamed = await client.callTool({
      name: 'workflow_rename_node',
      arguments: { workflow: 'sample', nodeId: 'work', newId: 'middle' },
    });

    // Both edges the renamed block sat between.
    expect(renamed.structuredContent).toMatchObject({
      applied: true,
      updatedReferences: 2,
    });

    const deleted = await client.callTool({
      name: 'workflow_delete_node',
      arguments: { workflow: 'sample', nodeId: 'middle' },
    });

    // Its two edges gone and the gap bridged.
    expect(deleted.structuredContent).toMatchObject({
      applied: true,
      removedEdges: ['e1', 'e2'],
      bridgedEdge: 'e3',
    });

    const got = await client.callTool({
      name: 'workflow_get',
      arguments: { name: 'sample' },
    });
    const { ir } = got.structuredContent as {
      ir: { nodes: { id: string }[]; edges: { to: { node: string } }[] };
    };

    expect(ir.nodes.map((node) => node.id)).toEqual(['start', 'finish']);
    expect(ir.edges.map((edge) => edge.to.node)).toEqual(['finish']);
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
   * ships to offer a refresh, so it has to name
   * this repository and this commit and nothing
   * else. Asserted as the whole shape rather than
   * as one unambiguous token: a token is what a
   * stamp naming somebody else's branch also was.
   */
  it('ships a VERSION beside it', () => {
    const version = readFileSync(join(vendor(), 'VERSION'), 'utf8');

    expect(version).toMatch(/^mcp-server-v\d+\.\d+\.\d+\+[0-9a-f]{7}\n$/);
  });
});

/** A chain with a block in the middle to edit. */
const THREE_BLOCK_DRAFT = {
  title: 'A sample',
  nodes: [
    {
      id: 'start',
      title: 'Start',
      kind: 'trigger',
      config: { mode: 'manual' },
    },
    { id: 'work', title: 'Work', kind: 'step', config: {} },
    { id: 'finish', title: 'Finish', kind: 'step', config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 'start' }, to: { node: 'work' } },
    { id: 'e2', from: { node: 'work' }, to: { node: 'finish' } },
  ],
};

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
