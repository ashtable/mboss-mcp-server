import { NODE_PALETTE, WorkflowIRSchema, portsOf } from '@mboss/core';
import { describe, expect, it } from 'vitest';

import { coreFixture } from '../test-support/core-fixtures.js';

import {
  nodeCatalog,
  workflowSchema,
  type JsonSchema,
  type NodeCatalogEntry,
} from './json-schema.js';

/**
 * Whether a generated JSON Schema is a faithful
 * rendering of the Zod schema it came from is a
 * question about the emitted document, so these
 * tests read the document rather than the
 * generator. The workflows they check it against
 * are core's own fixtures, unparsed — a schema
 * that only accepts documents with every default
 * already filled in accepts none of the files this
 * project checks in.
 */

/** The kinds the fixtures below never build. */
const HAND_BUILT: Array<{ kind: string; config: unknown }> = [
  { kind: 'apiCall', config: { service: 'twilio' } },
  { kind: 'codeStep', config: {} },
];

/**
 * The kinds the port cross-check reaches: every
 * kind some checked-in workflow builds, less the
 * branch, whose ports are its own. The two kinds
 * no fixture builds are the ones hand-built above.
 */
const PORTS_CHECKED_AGAINST_CORE = [
  'approval',
  'durableWait',
  'emailSend',
  'loop',
  'step',
  'transaction',
  'trigger',
];

const CATALOG = nodeCatalog();

function entryFor(kind: string): NodeCatalogEntry {
  const entry = CATALOG.kinds.find((candidate) => candidate.kind === kind);
  if (entry === undefined) throw new Error(`no catalog entry for ${kind}`);

  return entry;
}

/** Every node of the named fixture, as written. */
function nodesOf(fixture: string): Array<{ kind: string; config: unknown }> {
  const { nodes } = coreFixture(fixture) as {
    nodes: Array<{ kind: string; config: unknown }>;
  };

  return nodes;
}

describe('the node catalog', () => {
  it('offers every kind the palette does, in that order', () => {
    expect(CATALOG.kinds.map((entry) => entry.kind)).toEqual(
      NODE_PALETTE.map((entry) => entry.kind),
    );
  });

  it('labels a kind the way the palette labels it', () => {
    expect(
      CATALOG.kinds.map(({ kind, label, group }) => ({ kind, label, group })),
    ).toEqual([...NODE_PALETTE]);
  });

  it('carries each config as a schema document of its own', () => {
    for (const entry of CATALOG.kinds) {
      expect(entry.config.$schema, entry.kind).toBeDefined();
      if (JSON.stringify(entry.config).includes('"$ref"')) {
        expect(entry.config.$defs, entry.kind).toBeDefined();
      }
    }
  });

  it('keeps the trigger modes discriminated', () => {
    const modes = branchConstants(entryFor('trigger').config, 'mode');

    expect(modes).toEqual(['manual', 'event', 'schedule']);
  });

  it('keeps the wait sources discriminated inside a wait', () => {
    const source = propertyOf(entryFor('durableWait').config, 'source');

    expect(branchConstants(source, 'kind')).toEqual(['form', 'event', 'timer']);
  });

  it('keeps the attachments discriminated inside an email', () => {
    const attach = propertyOf(entryFor('emailSend').config, 'attach');

    expect(branchConstants(attach, 'type')).toEqual([
      'none',
      'form',
      'artifactLink',
    ]);
  });

  /**
   * A recipient is either a fixed word or any email
   * address, so there is no discriminator to choose
   * a branch by. An `anyOf` says so; a `oneOf`
   * would claim the branches are mutually exclusive
   * when the generator has no way to know that.
   */
  it('leaves an undiscriminated union open', () => {
    const to = propertyOf(entryFor('emailSend').config, 'to');

    expect(to.oneOf).toBeUndefined();
    expect(to.anyOf).toHaveLength(2);
  });

  it('lists the ports a node of each kind leaves by', () => {
    const checked: string[] = [];

    for (const fixture of FIXTURES) {
      for (const node of WorkflowIRSchema.parse(coreFixture(fixture)).nodes) {
        const entry = entryFor(node.kind);
        if (entry.portsFromConfig) continue;

        expect(entry.ports, node.kind).toEqual(portsOf(node));
        checked.push(node.kind);
      }
    }

    expect([...new Set(checked)].sort()).toEqual(PORTS_CHECKED_AGAINST_CORE);
  });

  /**
   * A branch's ports are the ones its own cases
   * name, so the catalog has none to list in
   * advance and says which field to read instead.
   */
  it('says a branch names its own ports', () => {
    const branch = entryFor('branch');

    expect(branch.portsFromConfig).toBe(true);
    expect(branch.ports).toEqual([]);
    expect(propertyOf(branch.config, 'elsePort')).toBeDefined();
  });

  it('accepts every node config groom_booking is built from', () => {
    for (const node of nodesOf('groom_booking')) {
      const { config } = entryFor(node.kind);
      expectAccepted(config, config, node.config, node.kind);
    }
  });

  /**
   * `groom_booking` builds six of the ten kinds.
   * A fidelity gap in one of the other four would
   * otherwise hide behind the headline fixture.
   */
  it('accepts the four kinds groom_booking never builds', () => {
    const rest = [
      ...nodesOf('review_loop').filter((node) => node.kind === 'loop'),
      ...nodesOf('approval_flow').filter((node) => node.kind === 'approval'),
      ...HAND_BUILT,
    ];

    expect(rest.map((node) => node.kind)).toEqual([
      'loop',
      'approval',
      'apiCall',
      'codeStep',
    ]);

    for (const node of rest) {
      const { config } = entryFor(node.kind);
      expectAccepted(config, config, node.config, node.kind);
    }
  });

  it('accepts the wait sources and attachments the fixtures use', () => {
    for (const fixture of FIXTURES) {
      for (const node of nodesOf(fixture)) {
        const { config } = entryFor(node.kind);
        expectAccepted(config, config, node.config, `${fixture}/${node.kind}`);
      }
    }
  });
});

describe('the workflow schema', () => {
  const SCHEMA = workflowSchema();

  it('discriminates a node by its kind', () => {
    const kinds = branchConstants(nodeSchema(), 'kind');

    expect(kinds.sort()).toEqual(NODE_PALETTE.map((e) => e.kind).sort());
  });

  it('accepts groom_booking as it is written on disk', () => {
    expectAccepted(SCHEMA, SCHEMA, coreFixture('groom_booking'), 'workflow');
  });

  it('accepts every checked-in workflow', () => {
    for (const fixture of FIXTURES) {
      expectAccepted(SCHEMA, SCHEMA, coreFixture(fixture), fixture);
    }
  });

  /**
   * An author writes a document, not a parsed one.
   * Every field with a default is theirs to leave
   * out, and the fixtures do leave them out, so a
   * schema that required them would refuse the
   * files this project already ships.
   */
  it('asks an author for nothing that has a default', () => {
    const edge = itemsOf(propertyOf(SCHEMA, 'edges'));

    expect(edge.required).toEqual(['id', 'from', 'to']);
    expect(propertyOf(edge, 'from').required).toEqual(['node']);
  });

  function nodeSchema(): JsonSchema {
    return itemsOf(propertyOf(SCHEMA, 'nodes'));
  }
});

/**
 * The fixtures checked below: every workflow core
 * keeps, other than the empty draft, which has no
 * nodes to say anything about.
 */
const FIXTURES = [
  'approval_flow',
  'branch_three_ways',
  'chat_retry_abort',
  'chat_retry_continue',
  'form_intake',
  'form_retry',
  'groom_booking',
  'review_loop',
  'timer_wait',
];

/**
 * Asserts a schema accepts a value.
 *
 * Covers the constructs this generator emits and
 * nothing else: declared properties, required
 * keys, record values, array items, internal refs
 * and unions chosen by a constant. Types, patterns
 * and enums are Zod's own job — the question here
 * is whether the shape survived being written out.
 */
function expectAccepted(
  root: JsonSchema,
  schema: JsonSchema,
  value: unknown,
  path: string,
): void {
  const here = deref(root, schema);

  if (Array.isArray(value)) {
    const items = here.items;
    if (isSchema(items)) {
      value.forEach((item, index) =>
        expectAccepted(root, items, item, `${path}[${index}]`),
      );
    }

    return;
  }

  if (value === null || typeof value !== 'object') return;

  /**
   * An open union has no discriminator to pick a
   * branch by, so there is nothing here to check.
   * That it stayed open is asserted on its own.
   */
  if (here.anyOf !== undefined) return;

  if (here.oneOf !== undefined) {
    const claiming = here.oneOf.filter((option) => claims(option, value));

    expect(
      claiming,
      `${path}: one branch for ${JSON.stringify(value)}`,
    ).toHaveLength(1);
    expectAccepted(root, claiming[0] as JsonSchema, value, path);

    return;
  }

  for (const key of here.required ?? []) {
    expect(Object.hasOwn(value, key), `${path}: missing ${key}`).toBe(true);
  }

  for (const [key, member] of Object.entries(value)) {
    const declared = here.properties?.[key] ?? here.additionalProperties;

    expect(isSchema(declared), `${path}: ${key} is undeclared`).toBe(true);
    if (isSchema(declared)) {
      expectAccepted(root, declared, member, `${path}.${key}`);
    }
  }
}

/** Whether a branch's constants match a value. */
function claims(branch: JsonSchema, value: object): boolean {
  return Object.entries(branch.properties ?? {}).every(([key, member]) => {
    if (!isSchema(member) || member.const === undefined) return true;

    return member.const === (value as Record<string, unknown>)[key];
  });
}

/** The constant each branch of a union claims. */
function branchConstants(schema: JsonSchema, discriminator: string): unknown[] {
  const branches = schema.oneOf ?? [];

  return branches.map((branch) => {
    const member = branch.properties?.[discriminator];

    return isSchema(member) ? member.const : undefined;
  });
}

function propertyOf(schema: JsonSchema, name: string): JsonSchema {
  const member = schema.properties?.[name];
  if (!isSchema(member)) throw new Error(`no property ${name}`);

  return member;
}

function itemsOf(schema: JsonSchema): JsonSchema {
  const { items } = schema;
  if (!isSchema(items)) throw new Error('not an array schema');

  return items;
}

/** Follows an internal ref back to what it names. */
function deref(root: JsonSchema, schema: JsonSchema): JsonSchema {
  const { $ref } = schema;
  if ($ref === undefined) return schema;

  const target = root.$defs?.[$ref.replace('#/$defs/', '')];
  expect(target, `nothing defined at ${$ref}`).toBeDefined();

  return target ?? schema;
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
