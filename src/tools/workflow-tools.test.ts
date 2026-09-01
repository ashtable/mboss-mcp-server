import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  proposalFile,
  readProposal,
  type Diagnostic,
  type WorkflowIR,
} from '@mboss/core';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { format } from 'prettier';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorCodeOf } from '../errors.js';
import type { ToolDefinition } from '../registry.js';
import { runTool } from '../server.js';
import {
  makeBareDirectory,
  makeFixtureProject,
  type ProjectFixture,
} from '../test-support/fixture-project.js';

import { workflowApplySpec } from './workflow-apply-spec.js';
import { workflowCreate } from './workflow-create.js';
import { workflowDeleteNode } from './workflow-delete-node.js';
import { workflowGet } from './workflow-get.js';
import { workflowRenameNode } from './workflow-rename-node.js';
import { workflowScaffoldStep } from './workflow-scaffold-step.js';
import { workflowValidate } from './workflow-validate.js';

/**
 * The workflow tools against a real project in a
 * temp directory. Nothing is stubbed: these write
 * the files an agent's edits actually land in, and
 * the round trip below is the whole point of the
 * surface.
 */

let fixture: ProjectFixture;

beforeEach(() => {
  fixture = makeFixtureProject();
});

afterEach(() => {
  fixture.cleanup();
});

function call(tool: ToolDefinition, args: object): Promise<CallToolResult> {
  return tool.run(args, {
    projectDir: fixture.dir,
    mbossDir: fixture.mbossDir,
    proposedBy: 'the tests',
  });
}

/** The answer of a call the test expects to work. */
async function output<T>(result: Promise<CallToolResult>): Promise<T> {
  const settled = await result;

  if (settled.isError === true) {
    throw new Error(
      `unexpected failure: ${JSON.stringify(settled.structuredContent)}`,
    );
  }

  return settled.structuredContent as T;
}

/** The code of a call the test expects to fail. */
async function code(result: Promise<CallToolResult>): Promise<unknown> {
  return errorCodeOf(await result);
}

/** The whole failure, for the tests that read its detail. */
async function failure(
  result: Promise<CallToolResult>,
): Promise<Record<string, unknown>> {
  const settled = await result;
  expect(settled.isError).toBe(true);

  return settled.structuredContent as Record<string, unknown>;
}

type GetOutput = {
  name: string;
  path: string;
  revision: number;
  ir: WorkflowIR;
  diagnostics: Diagnostic[];
};

type ApplyOutput = {
  valid: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  summary: Record<string, number>;
  proposalId?: string;
  applied: boolean;
  revision?: number;
};

/** A trigger and one step wired together. */
const DRAFT = {
  title: 'A sample',
  nodes: [
    {
      id: 'start',
      title: 'Start',
      kind: 'trigger',
      config: { mode: 'manual' },
    },
    { id: 'work', title: 'Work', kind: 'step', config: {} },
  ],
  edges: [{ id: 'e1', from: { node: 'start' }, to: { node: 'work' } }],
};

/** The same, with a third block on the end. */
const LONGER_DRAFT = {
  ...DRAFT,
  nodes: [
    ...DRAFT.nodes,
    { id: 'finish', title: 'Finish', kind: 'step', config: {} },
  ],
  edges: [
    ...DRAFT.edges,
    { id: 'e2', from: { node: 'work' }, to: { node: 'finish' } },
  ],
};

/** An edge to a block that is not there. */
const BROKEN_DRAFT = {
  ...DRAFT,
  edges: [
    ...DRAFT.edges,
    { id: 'e2', from: { node: 'work' }, to: { node: 'nowhere' } },
  ],
};

async function createSample(): Promise<void> {
  await output(call(workflowCreate, { name: 'sample' }));
}

/** Puts `spec` on disk and answers with its revision. */
async function applySample(
  spec: object,
  baseRevision: number,
): Promise<number> {
  const applied = await output<ApplyOutput>(
    call(workflowApplySpec, {
      name: 'sample',
      spec,
      dryRun: false,
      baseRevision,
    }),
  );

  return applied.revision ?? 0;
}

describe('workflow_create', () => {
  it('creates an empty draft at revision 1', async () => {
    const created = await output<GetOutput>(
      call(workflowCreate, { name: 'sample', title: 'A sample' }),
    );

    expect(created.revision).toBe(1);
    expect(created.ir.nodes).toEqual([]);
    expect(created.ir.title).toBe('A sample');
    expect(existsSync(created.path)).toBe(true);
  });

  it('refuses to create one that is already there', async () => {
    await createSample();

    expect(await code(call(workflowCreate, { name: 'sample' }))).toBe(
      'REVISION_CONFLICT',
    );
  });
});

describe('workflow_get', () => {
  it('reads a workflow, its revision and its diagnostics', async () => {
    await createSample();
    await applySample(DRAFT, 1);

    const got = await output<GetOutput>(call(workflowGet, { name: 'sample' }));

    expect(got.name).toBe('sample');
    expect(got.revision).toBe(2);
    expect(got.ir.nodes.map((node) => node.id)).toEqual(['start', 'work']);
    // The step has no code behind it yet, which is
    // a warning rather than a reason to refuse.
    expect(got.diagnostics.map((found) => found.code)).toContain('V07');
  });

  it('reads the current workflow when none is named', async () => {
    await createSample();

    const got = await output<GetOutput>(call(workflowGet, {}));

    expect(got.name).toBe('sample');
  });

  it('says so when it had to guess which workflow was meant', async () => {
    await createSample();
    await output(call(workflowCreate, { name: 'another' }));

    const settled = await call(workflowGet, {});
    const spoken = settled.content
      ?.map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');

    expect(spoken).toContain('Name one to be certain');
  });
});

describe('the round trip', () => {
  it('creates, dry-runs, applies and gets back the same graph', async () => {
    await createSample();

    const preview = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: true,
        baseRevision: 1,
      }),
    );

    expect(preview.applied).toBe(false);
    expect(preview.summary).toMatchObject({ nodesAdded: 2, edgesAdded: 1 });
    expect(preview.proposalId).toBeDefined();

    const id = preview.proposalId ?? '';
    expect(existsSync(proposalFile(fixture.mbossDir, id))).toBe(true);

    // The dry run only proposed: the document on
    // disk has not moved.
    const before = await output<GetOutput>(call(workflowGet, {}));
    expect(before.revision).toBe(1);

    const applied = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: false,
        baseRevision: 1,
        proposalId: id,
      }),
    );

    expect(applied.applied).toBe(true);
    expect(applied.revision).toBe(2);
    expect((await readProposal(fixture.mbossDir, id))?.status).toBe('applied');

    const got = await output<GetOutput>(call(workflowGet, { name: 'sample' }));
    expect(got.revision).toBe(2);
    expect(got.ir.nodes.map((node) => node.id)).toEqual(['start', 'work']);
    expect(got.ir.edges.map((edge) => edge.id)).toEqual(['e1']);
  });
});

describe('workflow_apply_spec', () => {
  it('applies a spec nobody previewed', async () => {
    await createSample();

    const applied = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: false,
        baseRevision: 1,
      }),
    );

    expect(applied.applied).toBe(true);
    expect(applied.revision).toBe(2);
    expect(applied.proposalId).toBeUndefined();
  });

  it('applies a spec whose only findings are warnings', async () => {
    await createSample();

    const applied = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: false,
        baseRevision: 1,
      }),
    );

    expect(applied.valid).toBe(true);
    expect(applied.errors).toEqual([]);
    expect(applied.warnings.map((found) => found.code)).toContain('V07');
  });

  /**
   * The pair below is what pins this server to the
   * same answer the canvas gives. A wire's type has
   * to be a type the code-behind exports, and only
   * a scan of `lib/` knows which those are — so a
   * server that stopped scanning would accept specs
   * the canvas refuses.
   */
  const TYPED_EDGE = {
    ...DRAFT,
    edges: [
      {
        id: 'e1',
        from: { node: 'start' },
        to: { node: 'work' },
        type: 'Booking',
      },
    ],
  };

  it('refuses a wire carrying a type the code-behind has not got', async () => {
    await createSample();

    const found = await failure(
      call(workflowApplySpec, {
        name: 'sample',
        spec: TYPED_EDGE,
        dryRun: true,
        baseRevision: 1,
      }),
    );

    expect(found['code']).toBe('VALIDATION_FAILED');
    expect(found['errors']).toEqual([expect.objectContaining({ code: 'V06' })]);
  });

  it('accepts the same wire once the type is exported', async () => {
    await mkdir(join(fixture.dir, 'lib'), { recursive: true });
    writeFileSync(
      join(fixture.dir, 'lib', 'types.ts'),
      'export type Booking = { id: string };\n',
      'utf8',
    );
    await createSample();

    const applied = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: TYPED_EDGE,
        dryRun: false,
        baseRevision: 1,
      }),
    );

    expect(applied.errors).toEqual([]);
    expect(applied.revision).toBe(2);
  });

  it('names whose edit it is when it writes a proposal', async () => {
    await createSample();

    const preview = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: true,
        baseRevision: 1,
      }),
    );

    const proposal = await readProposal(
      fixture.mbossDir,
      preview.proposalId ?? '',
    );

    expect(proposal?.proposedBy).toBe('the tests');
  });
});

describe('workflow_validate', () => {
  it('checks a workflow that is on disk', async () => {
    await createSample();
    await applySample(DRAFT, 1);

    const checked = await output<ApplyOutput>(
      call(workflowValidate, { name: 'sample' }),
    );

    expect(checked.valid).toBe(true);
    expect(checked.warnings.map((found) => found.code)).toContain('V07');
  });

  it('checks a spec that is not on disk at all', async () => {
    const checked = await output<ApplyOutput>(
      call(workflowValidate, { spec: BROKEN_DRAFT }),
    );

    expect(checked.valid).toBe(false);
    expect(checked.errors.map((found) => found.code)).toContain('V02');
  });

  it('changes nothing about a workflow it checks', async () => {
    await createSample();

    await call(workflowValidate, { name: 'sample' });

    const got = await output<GetOutput>(call(workflowGet, { name: 'sample' }));
    expect(got.revision).toBe(1);
  });

  it('refuses a call that names neither a workflow nor a spec', async () => {
    await expect(call(workflowValidate, {})).rejects.toThrow(/one of/);
  });

  it('refuses a call that names both', async () => {
    await createSample();

    await expect(
      call(workflowValidate, { name: 'sample', spec: DRAFT }),
    ).rejects.toThrow(/one of/);
  });
});

describe('workflow_scaffold_step', () => {
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

  type ScaffoldOutput = {
    created: Array<{ path: string; export: string; signature: string }>;
    skipped?: { reason: string; path: string };
  };

  async function withTypedDraft(): Promise<void> {
    await mkdir(join(fixture.dir, 'lib'), { recursive: true });
    writeFileSync(
      join(fixture.dir, 'lib', 'types.ts'),
      'export type Booking = { id: string };\n' +
        'export type Slot = { at: string };\n',
      'utf8',
    );

    await createSample();
    await applySample(TYPED_DRAFT, 1);
  }

  it('writes a typed handler stub and its test', async () => {
    await withTypedDraft();

    await output(
      call(workflowScaffoldStep, { workflow: 'sample', nodeId: 'work' }),
    );

    const handler = readFileSync(
      join(fixture.dir, 'lib', 'findSlot.ts'),
      'utf8',
    );

    expect(handler).toContain(
      "import type { Booking, Slot } from './types.js';",
    );
    expect(handler).toContain(
      'export async function findSlot(input: Booking): Promise<Slot>',
    );
    expect(existsSync(join(fixture.dir, 'lib', 'findSlot.test.ts'))).toBe(true);
  });

  it('reports the created paths, the export and the signature', async () => {
    await withTypedDraft();

    const scaffolded = await output<ScaffoldOutput>(
      call(workflowScaffoldStep, { workflow: 'sample', nodeId: 'work' }),
    );

    expect(scaffolded.created.map((file) => file.path)).toEqual([
      join(fixture.dir, 'lib', 'findSlot.ts'),
      join(fixture.dir, 'lib', 'findSlot.test.ts'),
    ]);
    expect(scaffolded.created[0]?.export).toBe('findSlot');
    expect(scaffolded.created[0]?.signature).toBe(
      'export async function findSlot(input: Booking): Promise<Slot>',
    );
  });

  it('skips a handler that is already written', async () => {
    await withTypedDraft();
    const path = join(fixture.dir, 'lib', 'findSlot.ts');
    writeFileSync(path, '// mine\n', 'utf8');

    const scaffolded = await output<ScaffoldOutput>(
      call(workflowScaffoldStep, { workflow: 'sample', nodeId: 'work' }),
    );

    expect(scaffolded.created).toEqual([]);
    expect(scaffolded.skipped).toEqual({ reason: 'handler-exists', path });
    expect(readFileSync(path, 'utf8')).toBe('// mine\n');
  });

  it('leaves both stubs the way prettier wants them', async () => {
    await withTypedDraft();

    const scaffolded = await output<ScaffoldOutput>(
      call(workflowScaffoldStep, { workflow: 'sample', nodeId: 'work' }),
    );

    // The projects these land in run
    // `prettier --check` over `lib/`, and they
    // format to the same settings this repo does.
    for (const file of scaffolded.created) {
      const written = readFileSync(file.path, 'utf8');

      expect(
        await format(written, {
          parser: 'typescript',
          singleQuote: true,
          semi: true,
          printWidth: 80,
        }),
      ).toBe(written);
    }
  });

  it('breaks a signature too wide to fit, the way prettier would', async () => {
    await mkdir(join(fixture.dir, 'lib'), { recursive: true });
    writeFileSync(
      join(fixture.dir, 'lib', 'types.ts'),
      'export type AVeryLongIncomingPayloadTypeName = { id: string };\n' +
        'export type AnEquallyLongOutgoingResultTypeName = { at: string };\n',
      'utf8',
    );

    await createSample();
    await applySample(
      {
        ...TYPED_DRAFT,
        nodes: [
          TYPED_DRAFT.nodes[0],
          {
            ...TYPED_DRAFT.nodes[1],
            in: 'AVeryLongIncomingPayloadTypeName',
            out: 'AnEquallyLongOutgoingResultTypeName',
            handler: { export: 'aRatherLongHandlerName' },
          },
        ],
      },
      1,
    );

    await output(
      call(workflowScaffoldStep, { workflow: 'sample', nodeId: 'work' }),
    );

    const written = readFileSync(
      join(fixture.dir, 'lib', 'aRatherLongHandlerName.ts'),
      'utf8',
    );

    expect(written).toContain(
      'export async function aRatherLongHandlerName(\n',
    );
    expect(
      await format(written, {
        parser: 'typescript',
        singleQuote: true,
        semi: true,
        printWidth: 80,
      }),
    ).toBe(written);
  });

  it('still names a type the code-behind has not got yet', async () => {
    await createSample();
    await applySample(TYPED_DRAFT, 1);

    await output(
      call(workflowScaffoldStep, { workflow: 'sample', nodeId: 'work' }),
    );

    const written = readFileSync(
      join(fixture.dir, 'lib', 'findSlot.ts'),
      'utf8',
    );

    expect(written).not.toContain('import');
    expect(written).toContain('(input: Booking): Promise<Slot>');
    expect(written).toContain('`Booking` is not exported from `lib/` yet.');
  });

  it('refuses a node with no handler to scaffold', async () => {
    await createSample();
    await applySample(DRAFT, 1);

    await expect(
      call(workflowScaffoldStep, { workflow: 'sample', nodeId: 'work' }),
    ).rejects.toThrow(/handler/);
  });
});

describe('workflow_rename_node', () => {
  type EditOutput = {
    applied: true;
    revision: number;
    updatedReferences?: number;
    removedEdges?: string[];
    bridgedEdge?: string;
  };

  it('renames a node and counts the references it moved', async () => {
    await createSample();
    await applySample(LONGER_DRAFT, 1);

    const renamed = await output<EditOutput>(
      call(workflowRenameNode, {
        workflow: 'sample',
        nodeId: 'work',
        newId: 'middle',
      }),
    );

    expect(renamed.updatedReferences).toBe(2);
    expect(renamed.revision).toBe(3);

    const got = await output<GetOutput>(call(workflowGet, { name: 'sample' }));
    expect(got.ir.nodes.map((node) => node.id)).toEqual([
      'start',
      'middle',
      'finish',
    ]);
    expect(got.ir.edges[1]?.from.node).toBe('middle');
  });

  it('refuses a node that is not in the workflow', async () => {
    await createSample();
    await applySample(DRAFT, 1);

    await expect(
      call(workflowRenameNode, {
        workflow: 'sample',
        nodeId: 'nope',
        newId: 'other',
      }),
    ).rejects.toThrow(/nope/);
  });

  it('reports a workflow that is not there', async () => {
    expect(
      await code(
        call(workflowRenameNode, {
          workflow: 'missing',
          nodeId: 'work',
          newId: 'other',
        }),
      ),
    ).toBe('WORKFLOW_NOT_FOUND');
  });
});

describe('workflow_delete_node', () => {
  type EditOutput = {
    applied: true;
    revision: number;
    removedEdges: string[];
    bridgedEdge?: string;
  };

  it('removes the node, its edges, and bridges the gap', async () => {
    await createSample();
    await applySample(LONGER_DRAFT, 1);

    const deleted = await output<EditOutput>(
      call(workflowDeleteNode, { workflow: 'sample', nodeId: 'work' }),
    );

    expect(deleted.removedEdges).toEqual(['e1', 'e2']);
    expect(deleted.bridgedEdge).toBe('e3');

    const got = await output<GetOutput>(call(workflowGet, { name: 'sample' }));
    expect(got.ir.nodes.map((node) => node.id)).toEqual(['start', 'finish']);
    expect(got.ir.edges).toHaveLength(1);
    expect(got.ir.edges[0]?.to.node).toBe('finish');
  });

  it('leaves the gap open when asked not to reconnect', async () => {
    await createSample();
    await applySample(LONGER_DRAFT, 1);

    const deleted = await output<EditOutput>(
      call(workflowDeleteNode, {
        workflow: 'sample',
        nodeId: 'work',
        reconnect: false,
      }),
    );

    expect(deleted.bridgedEdge).toBeUndefined();

    const got = await output<GetOutput>(call(workflowGet, { name: 'sample' }));
    expect(got.ir.edges).toEqual([]);
  });

  /**
   * Deleting the email a wait is waiting on leaves
   * the wait waiting for something nobody will
   * send. Only its author can say what should
   * happen instead, so the delete is refused and
   * nothing is written.
   */
  it('refuses to delete an email a form wait depends on', async () => {
    const withForm = {
      title: 'A sample',
      nodes: [
        {
          id: 'start',
          title: 'Start',
          kind: 'trigger',
          config: { mode: 'manual' },
        },
        {
          id: 'send_form',
          title: 'Send the form',
          kind: 'emailSend',
          config: {
            to: 'someone@example.com',
            subject: 'Please answer',
            bodyMarkdown: 'Follow the link.',
            attach: { type: 'form', form: { fields: [] } },
          },
        },
        {
          id: 'wait_reply',
          title: 'Wait for the reply',
          kind: 'durableWait',
          config: {
            source: { kind: 'form', email: 'send_form' },
            onTimeout: 'abort',
          },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'start' }, to: { node: 'send_form' } },
        { id: 'e2', from: { node: 'send_form' }, to: { node: 'wait_reply' } },
      ],
    };

    await createSample();
    await applySample(withForm, 1);

    const found = await failure(
      call(workflowDeleteNode, { workflow: 'sample', nodeId: 'send_form' }),
    );

    expect(found['code']).toBe('VALIDATION_FAILED');
    expect(found['errors']).toEqual([
      expect.objectContaining({ code: 'V09', nodeId: 'wait_reply' }),
    ]);

    // Refused means nothing was written.
    const got = await output<GetOutput>(call(workflowGet, { name: 'sample' }));
    expect(got.revision).toBe(2);
    expect(got.ir.nodes).toHaveLength(3);
  });
});

describe('every structured error', () => {
  it('produces WORKFLOW_NOT_FOUND', async () => {
    expect(await code(call(workflowGet, { name: 'nope' }))).toBe(
      'WORKFLOW_NOT_FOUND',
    );
  });

  it('produces REVISION_CONFLICT, with both revisions', async () => {
    await createSample();
    await applySample(DRAFT, 1);

    const found = await failure(
      call(workflowApplySpec, {
        name: 'sample',
        spec: LONGER_DRAFT,
        dryRun: false,
        baseRevision: 1,
      }),
    );

    expect(found).toEqual({
      code: 'REVISION_CONFLICT',
      expected: 1,
      actual: 2,
    });
  });

  it('produces VALIDATION_FAILED, with the errors', async () => {
    await createSample();

    const found = await failure(
      call(workflowApplySpec, {
        name: 'sample',
        spec: BROKEN_DRAFT,
        dryRun: true,
        baseRevision: 1,
      }),
    );

    expect(found['code']).toBe('VALIDATION_FAILED');
    expect(found['errors']).toEqual([
      expect.objectContaining({ code: 'V02', severity: 'error' }),
    ]);
  });

  it('produces NO_CURRENT_WORKFLOW', async () => {
    expect(await code(call(workflowGet, {}))).toBe('NO_CURRENT_WORKFLOW');
  });

  it('produces NOT_AN_MBOSS_PROJECT', async () => {
    const bare = makeBareDirectory();

    try {
      const result = await runTool(workflowGet, {}, bare.dir);

      expect(errorCodeOf(result)).toBe('NOT_AN_MBOSS_PROJECT');
    } finally {
      bare.cleanup();
    }
  });

  it('produces PROPOSAL_NOT_FOUND for an id nobody minted', async () => {
    await createSample();

    expect(
      await code(
        call(workflowApplySpec, {
          name: 'sample',
          spec: DRAFT,
          dryRun: false,
          baseRevision: 1,
          proposalId: 'prop_1_0000beef',
        }),
      ),
    ).toBe('PROPOSAL_NOT_FOUND');
  });

  it('produces PROPOSAL_NOT_FOUND for one already applied', async () => {
    await createSample();

    const preview = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: true,
        baseRevision: 1,
      }),
    );
    const proposalId = preview.proposalId ?? '';

    const apply = {
      name: 'sample',
      spec: DRAFT,
      dryRun: false,
      baseRevision: 1,
      proposalId,
    };
    await output(call(workflowApplySpec, apply));

    expect(await code(call(workflowApplySpec, apply))).toBe(
      'PROPOSAL_NOT_FOUND',
    );
  });

  it('produces PROPOSAL_STALE, with both revisions', async () => {
    await createSample();

    const preview = await output<ApplyOutput>(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: true,
        baseRevision: 1,
      }),
    );

    // Somebody else's edit lands while the
    // proposal is waiting to be approved.
    await applySample(LONGER_DRAFT, 1);

    const found = await failure(
      call(workflowApplySpec, {
        name: 'sample',
        spec: DRAFT,
        dryRun: false,
        baseRevision: 1,
        proposalId: preview.proposalId,
      }),
    );

    expect(found).toEqual({
      code: 'PROPOSAL_STALE',
      baseRevision: 1,
      currentRevision: 2,
    });
  });
});
