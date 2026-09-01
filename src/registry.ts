import type { CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';

import type { ToolContext } from './project.js';
import { projectBuild } from './tools/project-build.js';
import { projectDebug } from './tools/project-debug.js';
import { projectDeploy } from './tools/project-deploy.js';
import { projectTest } from './tools/project-test.js';
import { workflowApplySpec } from './tools/workflow-apply-spec.js';
import { workflowCreate } from './tools/workflow-create.js';
import { workflowDeleteNode } from './tools/workflow-delete-node.js';
import { workflowGet } from './tools/workflow-get.js';
import { workflowRenameNode } from './tools/workflow-rename-node.js';
import { workflowScaffoldStep } from './tools/workflow-scaffold-step.js';
import { workflowValidate } from './tools/workflow-validate.js';

/**
 * One tool, as everything downstream reads it:
 * the server registers it, the manifest renders
 * it, and the shipped skill is checked against
 * it.
 *
 * `name` is the MCP tool name and carries
 * underscores, because the protocol restricts
 * tool names to letters, digits, underscores and
 * hyphens, and clients mangle or reject anything
 * else. The dotted form people read — and the
 * form the canvas shows — is `title`.
 *
 * A handler takes its arguments as `unknown` and
 * parses them with its own `inputSchema`. The
 * registry is one array holding tools of eleven
 * different argument shapes, so the shapes are
 * erased here; the parse at the top of a handler
 * is what puts each one back.
 */
export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  outputSchema: z.ZodObject;
  run(args: unknown, ctx: ToolContext): Promise<CallToolResult>;
};

/**
 * Every tool the server exposes, in the order it
 * registers them: the workflow tools, which read
 * and change the graph, then the project tools,
 * which build and run what the graph compiles to.
 *
 * Within the workflow tools the order is the order
 * an agent meets them — look, create, change,
 * check, then the three edits that are shorthand
 * for a change it would otherwise spell out in
 * full. The project tools follow the same idea:
 * build what the graph became, run it, ask what it
 * did, ship it.
 */
export const TOOLS: readonly ToolDefinition[] = [
  workflowGet,
  workflowCreate,
  workflowApplySpec,
  workflowValidate,
  workflowScaffoldStep,
  workflowRenameNode,
  workflowDeleteNode,
  projectBuild,
  projectTest,
  projectDebug,
  projectDeploy,
];
