import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * Renders a tool's answer.
 *
 * The answer travels in both channels for the same
 * reason a failure does: `structuredContent` is
 * what a client reads programmatically, and the
 * text block is what one that ignores structured
 * output still shows a person.
 *
 * `note` is for the things a tool has to say that
 * are not part of its declared output — that it
 * guessed which workflow was meant, so far. It is
 * a second text block rather than an extra field,
 * because the output shape is a contract other
 * repos read and a note is only ever for a reader.
 */
export function toolSuccess(value: object, note?: string): CallToolResult {
  const text = JSON.stringify(value, null, 2);

  return {
    structuredContent: { ...value },
    content:
      note === undefined
        ? [{ type: 'text', text }]
        : [
            { type: 'text', text },
            { type: 'text', text: note },
          ],
  };
}
