import type { ApplyError } from '@mboss/core';
import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * What a tool can fail with, as data.
 *
 * `@mboss/core` already owns every code that can
 * come out of reading or writing a workflow
 * document, and those codes are product surface
 * an agent matches on, so they are reused rather
 * than restated. Only the codes this server
 * originates are added here.
 */
export type ToolError = ApplyError | { code: 'NO_CURRENT_WORKFLOW' };

/**
 * Renders a failure as a tool result.
 *
 * A failure is a normal outcome an agent is meant
 * to handle, so it comes back as a result rather
 * than as a protocol error. The code travels in
 * both channels: `structuredContent` is what a
 * client reads programmatically, and the text
 * block is what one that ignores structured
 * output still shows a person.
 */
export function toolFailure(error: ToolError): CallToolResult {
  return {
    isError: true,
    structuredContent: { ...error },
    content: [{ type: 'text', text: JSON.stringify(error) }],
  };
}

/**
 * Renders a failure as a thrown error.
 *
 * A resource read has no second channel to put a
 * failure in — it either answers or it does not —
 * so the code travels in the message, as the same
 * JSON a failed tool call carries. A caller reads
 * it the same way either way.
 */
export function resourceFailure(error: ToolError): Error {
  return new Error(JSON.stringify(error));
}

/**
 * The code carried by a failed tool result, or
 * `undefined` if the result is not a failure.
 *
 * The single place anything reads a code back.
 * Both channels are tried so that a client which
 * drops one of them still yields the code.
 */
export function errorCodeOf(result: CallToolResult): string | undefined {
  if (!result.isError) return undefined;

  const structured = codeOf(result.structuredContent);
  if (structured !== undefined) return structured;

  const [block] = result.content ?? [];

  return block?.type === 'text' ? codeOf(JSON.parse(block.text)) : undefined;
}

function codeOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;

  const { code } = value as { code?: unknown };

  return typeof code === 'string' ? code : undefined;
}
