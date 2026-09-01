import { z } from 'zod';

import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';
import { NPM, outputTail, runCommand, type RunCommand } from './run-command.js';

const Input = z.object({
  /** Passed on to the runner as it stands, which
   *  is how a project's own test command decides
   *  what a filter means. */
  filter: z.string().optional(),
});

const Output = z.object({
  ok: z.boolean(),
  passed: z.number().int(),
  failed: z.number().int(),
  outputTail: z.string(),
});

/**
 * Runs the project's own test script.
 *
 * `npm run test` rather than vitest directly: the
 * script is the project's, and a project that has
 * changed what testing means for it should not
 * find this tool disagreeing.
 */
export function makeProjectTest(run: RunCommand): ToolDefinition {
  return {
    name: 'project_test',
    title: 'project.test',
    description:
      "Runs the project's tests and reports what passed and what failed.",
    inputSchema: Input,
    outputSchema: Output,
    run: (args, ctx) => test(Input.parse(args), ctx, run),
  };
}

export const projectTest = makeProjectTest(runCommand);

async function test(
  args: z.infer<typeof Input>,
  ctx: ToolContext,
  run: RunCommand,
) {
  const filter = args.filter === undefined ? [] : ['--', args.filter];
  const outcome = await run({
    cwd: ctx.projectDir,
    command: NPM,
    args: ['run', 'test', ...filter],
  });

  return toolSuccess({
    ok: outcome.ok,
    ...countsOf(outcome.output),
    outputTail: outputTail(outcome.output),
  });
}

/**
 * The counts off vitest's summary line, which
 * reads `Tests  1 failed | 4 passed (5)`.
 *
 * A run that printed no such line — a missing
 * script, a crash before any test ran — counts
 * nothing, and `ok` already carries the fact that
 * it did not work. Guessing a number from an
 * absent summary would be worse than saying none.
 */
function countsOf(output: string): { passed: number; failed: number } {
  const summary = /^\s*Tests\s+(.*)$/m.exec(output)?.[1] ?? '';

  return {
    passed: countIn(summary, 'passed'),
    failed: countIn(summary, 'failed'),
  };
}

function countIn(summary: string, word: string): number {
  const found = new RegExp(String.raw`(\d+) ${word}`).exec(summary);

  return found === null ? 0 : Number(found[1]);
}
