import { serveOverStdio } from './server.js';

/**
 * The bundle's entry point.
 *
 * A vendored copy of this server is started by an
 * agent inside the project it works on, so the
 * process's own working directory is the project.
 */
serveOverStdio(process.cwd());
