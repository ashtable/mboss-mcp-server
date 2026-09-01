import { Client } from '@modelcontextprotocol/client';
import type { VersionNegotiationMode } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorCodeOf } from './errors.js';
import { TOOLS, type ToolDefinition } from './registry.js';
import { runTool } from './server.js';
import { buildServerBundle } from './test-support/build-server.js';
import {
  makeBareDirectory,
  makeFixtureProject,
  type Fixture,
} from './test-support/fixture-project.js';

/**
 * The acceptance test for the whole bootstrap: a
 * real SDK client, a real child process, real
 * stdio. Nothing here reaches into the server's
 * own module graph.
 */
describe('the stdio server', () => {
  let bundle = '';
  const open: Array<{ client: Client; fixture: Fixture }> = [];

  beforeAll(async () => {
    bundle = await buildServerBundle();
  }, 60_000);

  afterEach(async () => {
    while (open.length > 0) {
      const session = open.pop();
      if (!session) continue;
      await session.client.close();
      session.fixture.cleanup();
    }
  });

  /**
   * `mode` selects the protocol era the client
   * opens with. It defaults to `'legacy'`, so the
   * modern era only gets exercised if a test asks
   * for it by name.
   */
  async function connect(mode?: VersionNegotiationMode): Promise<Client> {
    const fixture = makeFixtureProject();
    const client = new Client(
      { name: 'mboss-mcp-server tests', version: '0.0.0' },
      mode ? { versionNegotiation: { mode } } : undefined,
    );
    open.push({ client, fixture });

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [bundle],
        cwd: fixture.dir,
      }),
    );

    return client;
  }

  it('lists its tools to a real SDK client', async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      TOOLS.map((tool) => tool.name),
    );
  });

  it('titles its tools in the dotted form', async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.title)).toEqual(
      TOOLS.map((tool) => tool.title),
    );
  });

  it('lists its tools to a client that negotiates an era', async () => {
    const client = await connect('auto');

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      TOOLS.map((tool) => tool.name),
    );
  });

  /**
   * `'auto'` falls back to the 2025 era rather
   * than failing, so it cannot tell a server that
   * negotiated the modern era from one that never
   * offered it. Pinning the revision can: the
   * client refuses to connect unless the server
   * offers exactly this one.
   */
  it('negotiates the 2026-07-28 protocol era', async () => {
    const client = await connect({ pin: '2026-07-28' });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      TOOLS.map((tool) => tool.name),
    );
  });

  it('rejects a call to an unregistered tool', async () => {
    const client = await connect();

    await expect(
      client.callTool({ name: 'workflow_nope', arguments: {} }),
    ).rejects.toThrow(/workflow_nope/);
  });
});

describe('runTool', () => {
  const fixtures: Fixture[] = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.cleanup();
  });

  /** A registry entry that reports where it ran. */
  function reportingTool(): ToolDefinition {
    return {
      name: 'workflow_probe',
      title: 'workflow.probe',
      description: 'Reports the project it ran in.',
      inputSchema: z.object({}),
      outputSchema: z.object({ projectDir: z.string() }),
      run: (_args, ctx) =>
        Promise.resolve({
          structuredContent: { projectDir: ctx.projectDir },
          content: [{ type: 'text', text: ctx.projectDir }],
        }),
    };
  }

  it('hands a tool the project it was called in', async () => {
    const fixture = makeFixtureProject();
    fixtures.push(fixture);

    const result = await runTool(reportingTool(), {}, fixture.dir);

    expect(result.structuredContent).toEqual({ projectDir: fixture.dir });
  });

  it('fails with NOT_AN_MBOSS_PROJECT outside a project', async () => {
    const fixture = makeBareDirectory();
    fixtures.push(fixture);

    const result = await runTool(reportingTool(), {}, fixture.dir);

    expect(errorCodeOf(result)).toBe('NOT_AN_MBOSS_PROJECT');
  });
});
