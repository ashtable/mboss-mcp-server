import { Client } from '@modelcontextprotocol/client';
import type { VersionNegotiationMode } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildBundle } from './bundle.js';
import { errorCodeOf } from './errors.js';
import { TOOLS, type ToolDefinition } from './registry.js';
import { RESOURCES } from './resources.js';
import { runTool } from './server.js';
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
    bundle = (await buildBundle()).server;
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

  /**
   * A resource may answer with text or with bytes;
   * every one of these answers with text.
   */
  function bodyOf(read: Awaited<ReturnType<Client['readResource']>>) {
    const [content] = read.contents;
    if (content === undefined || !('text' in content)) {
      throw new Error('the read came back with no text');
    }

    return content;
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

  /**
   * The three cases below are what an in-process
   * test cannot answer: whether a real client
   * accepts what these tools actually send. Every
   * tool declares an output schema, and a coded
   * failure does not match it — so a client that
   * validated one against the other would reject
   * every failure this server has to report.
   */
  it('runs a workflow tool for a real SDK client', async () => {
    const client = await connect();

    await client.callTool({
      name: 'workflow_create',
      arguments: { name: 'sample' },
    });
    const read = await client.callTool({
      name: 'workflow_get',
      arguments: { name: 'sample' },
    });

    expect(read.isError ?? false).toBe(false);
    expect(read.structuredContent).toMatchObject({
      name: 'sample',
      revision: 1,
    });
  });

  it('sends a coded failure through as a tool error', async () => {
    const client = await connect();

    const read = await client.callTool({
      name: 'workflow_get',
      arguments: { name: 'nope' },
    });

    expect(errorCodeOf(read as CallToolResult)).toBe('WORKFLOW_NOT_FOUND');
  });

  /**
   * A refused argument is a thrown `Error`, which
   * the SDK turns into a failure whose only block
   * is the sentence it was thrown with. Reading a
   * code back off that has to answer "there is
   * none" — the helper is what every caller runs
   * on a failure, and it does not get to decide
   * which failures it can be handed.
   */
  it('sends a refused argument through as a tool error', async () => {
    const client = await connect();

    const checked = await client.callTool({
      name: 'workflow_validate',
      arguments: {},
    });

    expect(checked.isError).toBe(true);
    expect(errorCodeOf(checked as CallToolResult)).toBeUndefined();
  });

  it('lists its resources to a real SDK client', async () => {
    const client = await connect();

    const { resources } = await client.listResources();

    expect(resources.map((entry) => entry.uri)).toEqual(
      RESOURCES.map((entry) => entry.uri),
    );
  });

  it('reads a resource for a real SDK client', async () => {
    const client = await connect();

    const body = bodyOf(
      await client.readResource({ uri: 'mboss://node-catalog' }),
    );

    expect(body.uri).toBe('mboss://node-catalog');
    expect(body.mimeType).toBe('application/json');
    expect(JSON.parse(body.text)).toHaveProperty('kinds');
  });

  it('reads this project through a resource', async () => {
    const client = await connect();

    await client.callTool({
      name: 'workflow_create',
      arguments: { name: 'sample' },
    });
    const body = bodyOf(
      await client.readResource({ uri: 'mboss://current-workflow' }),
    );

    expect(JSON.parse(body.text)).toMatchObject({
      name: 'sample',
      revision: 1,
    });
  });

  /**
   * A resource has no result to put a coded failure
   * in, so the read fails outright and the code has
   * to survive in the message.
   */
  it('sends a failed resource read through as an error', async () => {
    const client = await connect();

    await expect(
      client.readResource({ uri: 'mboss://current-workflow' }),
    ).rejects.toThrow(/NO_CURRENT_WORKFLOW/);
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
