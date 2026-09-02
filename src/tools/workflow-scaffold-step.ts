import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  NodeIdSchema,
  WorkflowNameSchema,
  readWorkflow,
  type LibManifest,
  type WorkflowNode,
} from '@mboss/core';
import { z } from 'zod';

import { toolFailure } from '../errors.js';
import type { ToolContext } from '../project.js';
import type { ToolDefinition } from '../registry.js';

import { toolSuccess } from './result.js';
import { libManifest } from './workflow.js';

/**
 * The width the projects this writes into format
 * to. Their lint runs `prettier --check`, so a
 * stub that is too wide arrives failing it.
 */
const PRINT_WIDTH = 80;

const Input = z.object({
  workflow: WorkflowNameSchema,
  nodeId: NodeIdSchema,
});

const Output = z.object({
  created: z.array(
    z.object({
      path: z.string(),
      export: z.string(),
      signature: z.string(),
    }),
  ),
  /**
   * Present when the handler was already written.
   * Nothing is overwritten, ever: the code behind a
   * block is the author's.
   */
  skipped: z
    .object({ reason: z.literal('handler-exists'), path: z.string() })
    .optional(),
});

/**
 * Writes the code-behind a block is waiting for.
 *
 * The block already says what it takes and what it
 * produces, and the scan already says where those
 * types live, so the signature is not a guess —
 * which is the whole value of scaffolding it here
 * rather than describing it and hoping.
 */
export const workflowScaffoldStep: ToolDefinition = {
  name: 'workflow_scaffold_step',
  title: 'workflow.scaffold_step',
  description:
    'Writes typed handler and test stubs for a node with no code behind it.',
  inputSchema: Input,
  outputSchema: Output,
  run: (args, ctx) => scaffold(Input.parse(args), ctx),
};

async function scaffold(args: z.infer<typeof Input>, ctx: ToolContext) {
  const read = await readWorkflow(ctx.mbossDir, args.workflow);
  if (!read.ok) return toolFailure(read.error);

  const node = read.ir.nodes.find((each) => each.id === args.nodeId);
  if (node === undefined) {
    throw new Error(
      `\`${args.nodeId}\` is not a node in \`${args.workflow}\`.`,
    );
  }

  const handler = node.handler;
  if (handler === undefined) {
    throw new Error(
      `\`${node.id}\` names no handler, so there is nothing to write. ` +
        `Give the block one first — the name it exports is the name of ` +
        `the file this writes.`,
    );
  }

  const libDir = join(ctx.projectDir, 'lib');
  const handlerPath = join(libDir, `${handler.export}.ts`);

  if (existsSync(handlerPath)) {
    return toolSuccess({
      created: [],
      skipped: { reason: 'handler-exists', path: handlerPath },
    });
  }

  const signature = signatureOf(handler.export, node);
  const created = [{ path: handlerPath, export: handler.export, signature }];

  await mkdir(libDir, { recursive: true });
  await writeFile(
    handlerPath,
    handlerStub({
      node,
      workflow: read.ir.name,
      signature,
      imports: typeImports(node, libManifest(ctx), ctx.projectDir),
      unknownTypes: unknownTypes(node, libManifest(ctx)),
    }),
    'utf8',
  );

  // A test may already be there when the handler
  // is not — somebody wrote the test first. That
  // is a way of working, not a mistake to
  // overwrite.
  const testPath = join(libDir, `${handler.export}.test.ts`);
  if (!existsSync(testPath)) {
    await writeFile(testPath, testStub(handler.export, node.id), 'utf8');
    created.push({ path: testPath, export: handler.export, signature });
  }

  return toolSuccess({ created });
}

/**
 * The declaration the stub opens with.
 *
 * A block that takes nothing has no parameter, and
 * one that produces nothing returns `void` — both
 * are ordinary, since a step may exist only for
 * what it does elsewhere.
 */
function signatureOf(name: string, node: WorkflowNode): string {
  const param = node.in === undefined ? '' : `input: ${node.in}`;
  const returns = `Promise<${node.out ?? 'void'}>`;
  const oneLine = `export async function ${name}(${param}): ${returns}`;

  // The brace the file adds counts toward the
  // width, so it is measured here rather than
  // where the line is assembled.
  //
  // An empty parameter list is left alone however
  // wide the line gets: there is nothing in it to
  // break, so prettier puts it back on one line
  // and `prettier --check` fails on the stub.
  if (param === '' || `${oneLine} {`.length <= PRINT_WIDTH) return oneLine;

  return [
    `export async function ${name}(`,
    ...(param === '' ? [] : [`  ${param},`]),
    `): ${returns}`,
  ].join('\n');
}

type StubParts = {
  node: WorkflowNode;
  workflow: string;
  signature: string;
  imports: string[];
  unknownTypes: string[];
};

function handlerStub(parts: StubParts): string {
  const { node, workflow, signature, imports, unknownTypes: unknown } = parts;

  // The thrown value carries the input because a
  // handler that is still a stub fails inside a
  // run, where what it was called with is the only
  // thing worth knowing. It also means the
  // parameter is used, which the project's own
  // lint requires.
  const refusal =
    node.in === undefined
      ? "throw new Error('no implementation yet');"
      : 'throw new Error(`no implementation yet: ${JSON.stringify(input)}`);';

  return [
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    '/**',
    ' * TODO: write this handler.',
    ' *',
    ` * Scaffolded for the \`${node.id}\` block of \`${workflow}\`.`,
    ...(unknown.length === 0
      ? []
      : [
          ' *',
          ...unknown.map(
            (name) => ` * \`${name}\` is not exported from \`lib/\` yet.`,
          ),
        ]),
    ' */',
    `${signature} {`,
    `  ${refusal}`,
    '}',
    '',
  ].join('\n');
}

/**
 * A test that names what is missing rather than
 * one that passes.
 *
 * It imports nothing: the handler throws until
 * somebody writes it, so a stub that imported it
 * would either fail the project's test run or have
 * an import nothing uses, and both are noise on
 * the day the project is created.
 */
function testStub(exported: string, nodeId: string): string {
  return [
    "import { describe, it } from 'vitest';",
    '',
    `describe('${exported}', () => {`,
    `  it.todo('does what the \`${nodeId}\` block needs');`,
    '});',
    '',
  ].join('\n');
}

/**
 * The type names a node declares, in the order
 * they appear in its signature and without
 * repeats.
 */
function declaredTypes(node: WorkflowNode): string[] {
  return [...new Set([node.in, node.out])].filter(
    (name): name is string => name !== undefined,
  );
}

/**
 * The imports the stub needs, one line per file
 * the types come from.
 */
function typeImports(
  node: WorkflowNode,
  manifest: LibManifest,
  projectDir: string,
): string[] {
  const libDir = join(projectDir, 'lib');
  const bySource = new Map<string, string[]>();

  for (const name of declaredTypes(node)) {
    const source = manifest.typeSources[name];
    if (source === undefined) continue;

    const from = specifierFor(libDir, join(projectDir, source));
    bySource.set(from, [...(bySource.get(from) ?? []), name]);
  }

  return [...bySource.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([from, names]) => importLine(names, from));
}

/**
 * The declared types the scan has never seen.
 *
 * The stub still names them, because the block
 * says that is what it takes: a handler typed as
 * something else would be a lie the compiler
 * believes. It will not type-check until the type
 * exists, which is the right kind of failure — the
 * work is real and it is next.
 */
function unknownTypes(node: WorkflowNode, manifest: LibManifest): string[] {
  return declaredTypes(node).filter(
    (name) => manifest.typeSources[name] === undefined,
  );
}

function importLine(names: string[], from: string): string {
  const sorted = [...names].sort();
  const oneLine = `import type { ${sorted.join(', ')} } from '${from}';`;

  // One specifier stays on its line however wide
  // it gets, the same way an empty parameter list
  // does: prettier only breaks a list it can put
  // more than one thing on.
  if (sorted.length === 1 || oneLine.length <= PRINT_WIDTH) return oneLine;

  return [
    'import type {',
    ...sorted.map((name) => `  ${name},`),
    `} from '${from}';`,
  ].join('\n');
}

/**
 * How one file in `lib/` refers to another.
 *
 * The projects this writes into resolve modules
 * the way a bundler does and are checked with
 * `verbatimModuleSyntax`, so an import names the
 * `.js` the `.ts` will become, and a sibling needs
 * a leading `./` to be a relative path at all.
 */
function specifierFor(fromDir: string, target: string): string {
  const path = relative(fromDir, target).split(sep).join('/');
  const specifier = path.replace(/\.ts$/, '.js');

  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}
