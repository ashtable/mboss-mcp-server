import {
  DiagnosticSchema,
  compileProject,
  typecheckProject,
  type CompileResult,
  type Diagnostic,
  type TypeProblem,
} from '@mboss/core';
import { z } from 'zod';

import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';

/**
 * The zone a schedule gets when its trigger names
 * none.
 *
 * Fixed rather than read from the machine, because
 * regenerating a project has to produce the same
 * bytes on a laptop as in CI — otherwise the
 * generated code changes depending on who last
 * pressed build. A workflow that cares which zone
 * it runs in says so on its trigger.
 */
const DEFAULT_TIMEZONE = 'UTC';

const Input = z.object({});

const Output = z.object({
  ok: z.boolean(),
  codegenMs: z.number(),
  diagnostics: z.array(DiagnosticSchema),
  /**
   * Documents the compiler will not turn into
   * code, which is not the same as documents that
   * are wrong: these are legal drafts using
   * something this compiler cannot emit yet.
   * Without a place of their own they would come
   * back as a failure with nothing said about it.
   */
  unsupported: z.array(z.string()),
  tscErrors: z.array(z.string()),
});

/**
 * Regenerates every workflow's code, then checks
 * that the project still compiles.
 *
 * The two halves are one tool because the second
 * is what makes the first trustworthy: codegen
 * that writes a file calling a handler that does
 * not exist has not failed until something
 * type-checks it.
 *
 * The type-check only runs when codegen finished.
 * Type errors against half-regenerated code are
 * about the regeneration, not about the project,
 * and reporting them would send a reader to the
 * wrong file.
 */
export const projectBuild: ToolDefinition = {
  name: 'project_build',
  title: 'project.build',
  description: "Regenerates every workflow's code and type-checks the project.",
  inputSchema: Input,
  outputSchema: Output,
  run: (_args, ctx) => build(ctx),
};

async function build(ctx: ToolContext) {
  const startedAt = Date.now();
  // `compileProject` takes the project lock
  // itself, and the lock is not reentrant.
  const compiled = await compileProject(ctx.projectDir, {
    timezone: DEFAULT_TIMEZONE,
  });
  const codegenMs = Date.now() - startedAt;

  if (!compiled.ok) {
    return toolSuccess({
      ok: false,
      codegenMs,
      diagnostics: compiled.failures.flatMap(({ result }) =>
        diagnosticsOf(result),
      ),
      unsupported: compiled.failures.flatMap(({ name, result }) =>
        unsupportedOf(name, result),
      ),
      tscErrors: [],
    });
  }

  const checked = typecheckProject(ctx.projectDir);

  return toolSuccess({
    ok: checked.ok,
    codegenMs,
    diagnostics: [],
    unsupported: [],
    tscErrors: checked.ok ? [] : checked.problems.map(problemLine),
  });
}

function diagnosticsOf(result: CompileResult): Diagnostic[] {
  return !result.ok && result.reason === 'CANNOT_COMPILE'
    ? result.diagnostics
    : [];
}

function unsupportedOf(name: string, result: CompileResult): string[] {
  if (result.ok || result.reason !== 'UNSUPPORTED') return [];

  const where = result.nodeId === undefined ? name : `${name}.${result.nodeId}`;

  return [`${where}: ${result.message}`];
}

/**
 * One problem on one line: this is rendered in a
 * list or a terminal, and neither has anywhere to
 * put a structure.
 */
function problemLine(problem: TypeProblem): string {
  return `${problem.file}:${problem.line} ${problem.message}`;
}
