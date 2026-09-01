import { readWorkflow, workflowFile } from '@mboss/core';

import { resourceFailure } from './errors.js';
import { resolveProject, type ProjectPaths } from './project.js';
import { readConventions } from './resources/conventions.js';
import { resolveCurrentWorkflow } from './resources/current-workflow.js';
import { projectDiagnostics } from './resources/diagnostics.js';
import { nodeCatalog, workflowSchema } from './resources/json-schema.js';

/**
 * What an agent can read without changing
 * anything: what a workflow may be, what this
 * project's workflows are, and what is wrong with
 * them.
 *
 * Two of the five are about the product and answer
 * anywhere; the other three are about a project
 * and fail outside one. A read either answers or
 * throws — a resource has no result to put a coded
 * failure in — so the code travels in the thrown
 * message.
 */
export type ResourceDefinition = {
  /** The URI's own tail, which is how MCP names it. */
  name: string;
  uri: string;
  title: string;
  /** One line, ending in a full stop. */
  description: string;
  mimeType: string;
  read(cwd: string): Promise<string>;
};

const JSON_TYPE = 'application/json';

export const RESOURCES: readonly ResourceDefinition[] = [
  {
    name: 'node-catalog',
    uri: 'mboss://node-catalog',
    title: 'Node catalog',
    description:
      'The kinds a workflow is built from, their ports and their config ' +
      'schemas.',
    mimeType: JSON_TYPE,
    read: async () => asJson(nodeCatalog()),
  },
  {
    name: 'workflow-schema',
    uri: 'mboss://workflow-schema',
    title: 'Workflow schema',
    description: 'The JSON Schema a workflow document has to satisfy.',
    mimeType: JSON_TYPE,
    read: async () => asJson(workflowSchema()),
  },
  {
    name: 'current-workflow',
    uri: 'mboss://current-workflow',
    title: 'Current workflow',
    description: 'The workflow this project is working on, and its revision.',
    mimeType: JSON_TYPE,
    read: async (cwd) => currentWorkflow(projectAt(cwd)),
  },
  {
    name: 'diagnostics',
    uri: 'mboss://diagnostics',
    title: 'Diagnostics',
    description:
      'Everything validation finds across the whole project, computed on ' +
      'read.',
    mimeType: JSON_TYPE,
    read: async (cwd) => asJson(await projectDiagnostics(projectAt(cwd))),
  },
  {
    name: 'conventions',
    uri: 'mboss://conventions',
    title: 'Conventions',
    description: "This project's own conventions for its code-behind.",
    mimeType: 'text/markdown',
    read: async (cwd) => readConventions(projectAt(cwd).mbossDir),
  },
];

/**
 * The current workflow with the envelope its
 * reader needs: which one it is, where it is, and
 * — when the answer was a guess — that it was one.
 * The note travels beside the document rather than
 * inside it, because the document is the project's
 * and this is the server's.
 */
async function currentWorkflow(project: ProjectPaths): Promise<string> {
  const outcome = resolveCurrentWorkflow(project.mbossDir);
  if (!outcome.ok) throw resourceFailure(outcome.error);

  const { name, ambiguity } = outcome.current;
  const read = await readWorkflow(project.mbossDir, name);
  if (!read.ok) throw resourceFailure(read.error);

  return asJson({
    name,
    path: workflowFile(project.mbossDir, name),
    revision: read.ir.revision,
    ir: read.ir,
    ...(ambiguity === undefined ? {} : { ambiguity }),
  });
}

/**
 * The project a read is about, or the same refusal
 * a tool call would give outside one.
 */
function projectAt(cwd: string): ProjectPaths {
  const outcome = resolveProject(cwd);
  if (!outcome.ok) throw resourceFailure(outcome.error);

  return outcome.project;
}

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
