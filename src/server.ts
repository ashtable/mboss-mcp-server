import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { toolFailure } from './errors.js';
import { resolveProject } from './project.js';
import { TOOLS, type ToolDefinition } from './registry.js';

/**
 * The one file that touches the MCP SDK.
 *
 * Everything else — the registry, the tools, the
 * resources — is ordinary TypeScript that knows
 * nothing about the protocol, so a change in the
 * SDK's shape is a change to this file alone.
 */

/** The name an agent registers this server under. */
export const SERVER_NAME = 'mboss';

/**
 * What the server reports as its version.
 *
 * A constant rather than a value read from
 * `package.json`, whose version never moves in
 * this repo family: the release branch name is
 * this repo's real version, and it is not
 * readable from inside a bundle.
 */
export const SERVER_VERSION = '0.0.0';

/**
 * What a proposal records when the client did not
 * say who it is.
 */
const UNKNOWN_AGENT = 'unknown agent';

/**
 * Runs one tool in the project `cwd` belongs to.
 *
 * The project is resolved per call rather than at
 * startup because a server may be started before
 * the project exists — an agent scaffolding a new
 * one is the ordinary case — and because the
 * failure belongs to the call that needed a
 * project, where an agent can see it.
 */
export async function runTool(
  tool: ToolDefinition,
  args: unknown,
  cwd: string,
  proposedBy: string = UNKNOWN_AGENT,
): Promise<CallToolResult> {
  const outcome = resolveProject(cwd);
  if (!outcome.ok) return toolFailure(outcome.error);

  return tool.run(args, { ...outcome.project, proposedBy });
}

/**
 * Builds the server with every registered tool on
 * it.
 *
 * `cwd` is the directory tool calls resolve their
 * project from; the entry point passes the
 * process's own, and tests pass a fixture.
 */
export function createServer(cwd: string): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      },
      (args) => runTool(tool, args, cwd, clientNameOf(server)),
    );
  }

  return server;
}

/**
 * What the connected client calls itself.
 *
 * Read per call rather than at startup: a server
 * is built before a client has said anything about
 * itself, and this is the only thing in the server
 * that cares who is on the other end.
 */
function clientNameOf(server: McpServer): string {
  return server.server.getClientVersion()?.name ?? UNKNOWN_AGENT;
}

/**
 * Serves the protocol over the process's own
 * stdio until the client disconnects.
 *
 * The SDK's stdio entry is what decides which
 * protocol era a connection speaks — a client
 * that opens with a discovery request gets the
 * current revision, one that opens with the older
 * handshake gets that — so the server is built
 * from a factory it calls once the era is known,
 * rather than wired to a transport directly.
 */
export function serveOverStdio(cwd: string): StdioServerHandle {
  return serveStdio(() => createServer(cwd));
}
