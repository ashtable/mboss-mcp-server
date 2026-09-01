import { spawn } from 'node:child_process';

/**
 * The one way this server runs somebody else's
 * command.
 *
 * `project_test` and `project_deploy` are both
 * thin by design — they run the script the
 * project's own `package.json` declares — and one
 * shared seam is what keeps the second of them
 * from being written a different way and tested
 * not at all.
 */

export type CommandRequest = {
  cwd: string;
  command: string;
  args: string[];
};

export type CommandOutcome = { ok: boolean; output: string };

export type RunCommand = (request: CommandRequest) => Promise<CommandOutcome>;

/**
 * How npm is spelled on this machine. Windows has
 * no `npm` on the path, only the shim beside it,
 * and spawning without a shell finds neither by
 * the other's name.
 */
export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * The number of lines of output a tool answers
 * with.
 *
 * Enough to carry a test summary or a deploy's
 * last complaint, and not so much that a long run
 * arrives as a wall of text in an agent's context.
 * The whole output is in the project's own
 * terminal for anyone who wants it.
 */
const TAIL_LINES = 50;

/**
 * Runs a command and answers with whether it
 * succeeded and everything it printed.
 *
 * Both streams are kept, interleaved as they
 * arrive: a failing script's reason is as likely
 * to be on one as the other, and separating them
 * would only make a reader reassemble the order.
 *
 * No shell. The arguments come from a tool's own
 * code and one caller's filter string, and a shell
 * would make that string executable.
 */
export const runCommand: RunCommand = ({ cwd, command, args }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    let output = '';

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('error', (error: Error) => {
      resolve({ ok: false, output: `${output}${error.message}\n` });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, output });
    });
  });

/** The last few lines of what a command printed. */
export function outputTail(output: string): string {
  return output.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');
}
