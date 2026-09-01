import { z } from 'zod';

import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';
import { NPM, outputTail, runCommand, type RunCommand } from './run-command.js';

const Input = z.object({});

const Output = z.object({
  ok: z.boolean(),
  outputTail: z.string(),
});

/**
 * Runs the project's own deploy script.
 *
 * Thin on purpose. Where a project deploys to is
 * the project's business — the scaffold writes
 * `railway up` and an author is free to change it
 * — so this tool knows the name of a script and
 * nothing about any host.
 */
export function makeProjectDeploy(run: RunCommand): ToolDefinition {
  return {
    name: 'project_deploy',
    title: 'project.deploy',
    description: "Runs the project's deploy script.",
    inputSchema: Input,
    outputSchema: Output,
    run: (_args, ctx) => deploy(ctx, run),
  };
}

export const projectDeploy = makeProjectDeploy(runCommand);

async function deploy(ctx: ToolContext, run: RunCommand) {
  const outcome = await run({
    cwd: ctx.projectDir,
    command: NPM,
    args: ['run', 'deploy'],
  });

  return toolSuccess({
    ok: outcome.ok,
    outputTail: outputTail(outcome.output),
  });
}
