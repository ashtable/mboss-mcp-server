# mboss-mcp-server

mBoss: Design Durable Apps with DBOS - Local MCP Server for mBoss VS Code Extension

The server speaks MCP over stdio and reads and writes a project's `.mboss/`
directory through `@mboss/core`, so it works the same whether or not the VS
Code extension is running.

## Layout

- `src/registry.ts` — every tool the server exposes. Tool names use
  underscores because the protocol restricts them to letters, digits,
  underscores and hyphens; the dotted form people read is each tool's `title`.
- `src/server.ts` — the only file that touches the MCP SDK.
- `src/main.ts` — the entry point the built bundle runs.
- `src/debug/` — the two read-only queries `project_debug` makes against a
  project's DBOS tables, and the mapping from their columns to its answer.
- `mboss-core/` — nested as a submodule and consumed as source through the
  `@mboss/core` path alias in `tsconfig.json` and `vitest.aliases.ts`. Both
  have to be kept in step; vitest reads neither tsconfig `paths` nor a
  package `main`.

## tools.manifest.json

`tools.manifest.json` is generated from the registry and checked in, so that
anything outside this repo — the shipped `mboss` skill's tool reference,
above all — can read the tool surface without loading the server.

`npm test` regenerates it in memory and fails on any difference, so a
registry change that leaves the manifest behind fails CI. To update it:

```
npm run build:manifest   # rewrites the file, then fails on purpose
npm test                 # confirms the new file matches
```

The regenerating run fails deliberately: a run that rewrites the file must
never be mistakable for a passing one, or a wrong manifest silently becomes
the new definition of right.

## What `project_debug` knows about DBOS

`project_debug` reads `dbos.workflow_status` and `dbos.operation_outputs`
with plain `pg`, not with the DBOS client library. This server ships as one
bundled file with no install step, vendored into somebody else's project, and
it reads the database _their_ app wrote — so pinning a client version against
a schema somebody else's DBOS created would couple the two for no gain, and a
client that creates its own schema is the wrong thing to point at a database
this tool may only read.

The cost is that those column names are knowledge this repo keeps by hand.
Three things pay for it: the mappers in `src/debug/queries.ts` are tested
against rows written the way DBOS's own types say it stores them, the queries
are tested for being reads and nothing else, and the end-to-end suite calls
this tool through the built bundle against a real generated app — which is
the first place in the plan a DBOS-created schema exists at all, and the only
place the column names can actually be confirmed.
