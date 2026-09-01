import {
  NODE_PALETTE,
  NodeSchema,
  WorkflowIRSchema,
  type NodeKind,
  type NodePaletteEntry,
} from '@mboss/core';
import { z } from 'zod';

/**
 * The catalog and the document schema, as JSON
 * Schema.
 *
 * Both are generated from the Zod schemas core
 * already owns rather than written out by hand, so
 * an agent reading them and the tools validating
 * what it writes are looking at one definition.
 */

/** A JSON Schema document, as Zod renders one. */
export type JsonSchema = z.core.JSONSchema.BaseSchema;

/**
 * What an author has to supply, rather than what a
 * parsed document holds.
 *
 * Every field with a default is theirs to leave
 * out — a workflow on disk legitimately omits an
 * edge's back flag or a branch case's iteration
 * bound — so a schema generated from the parsed
 * shape would refuse the documents this project
 * checks in. The cost is that unknown fields are
 * no longer forbidden, which is also the truth:
 * they are accepted and dropped.
 */
const AUTHORED = { io: 'input' } as const;

export type NodeCatalogEntry = NodePaletteEntry & {
  /**
   * The ports a node of this kind leaves by, empty
   * where the node names its own.
   */
  ports: readonly string[];
  /** Whether `ports` is empty for that reason. */
  portsFromConfig: boolean;
  /**
   * The kind's config, as a schema document
   * complete in itself — a reader can hand it
   * straight to a validator, definitions included.
   */
  config: JsonSchema;
};

export type NodeCatalog = { kinds: NodeCatalogEntry[] };

/**
 * Everything an agent needs to build a node: what
 * the kinds are called, where a run leaves them,
 * and what their config may say.
 */
export function nodeCatalog(): NodeCatalog {
  const configs = configSchemas();

  return {
    kinds: NODE_PALETTE.map((entry) => {
      const config = configs.get(entry.kind);
      if (config === undefined) {
        throw new Error(`the node catalog has no config for ${entry.kind}`);
      }

      return {
        ...entry,
        ...PORTS[entry.kind],
        config: z.toJSONSchema(config, AUTHORED),
      };
    }),
  };
}

/** The shape of a workflow document as a whole. */
export function workflowSchema(): JsonSchema {
  return z.toJSONSchema(WorkflowIRSchema, AUTHORED);
}

/**
 * Each kind's config schema, taken out of the node
 * union rather than listed again here, so a kind
 * added to core arrives in the catalog with it.
 */
function configSchemas(): Map<string, z.ZodType> {
  return new Map(
    NodeSchema.options.map((option) => [
      option.shape.kind.value,
      option.shape.config,
    ]),
  );
}

type CatalogPorts = { ports: readonly string[]; portsFromConfig: boolean };

const OUT: CatalogPorts = { ports: ['out'], portsFromConfig: false };

/**
 * The ports a node of each kind leaves by.
 *
 * Core answers this for a node that exists. A
 * catalog describes a kind before any node of it
 * does, and a branch's ports are the ones its own
 * cases name, so a branch has none to list in
 * advance. A test holds every other kind against
 * core's own answer for the checked-in workflows.
 */
const PORTS: Record<NodeKind, CatalogPorts> = {
  trigger: OUT,
  step: OUT,
  transaction: OUT,
  apiCall: OUT,
  branch: { ports: [], portsFromConfig: true },
  loop: OUT,
  durableWait: OUT,
  approval: { ports: ['approved', 'rejected'], portsFromConfig: false },
  emailSend: OUT,
  codeStep: OUT,
};
