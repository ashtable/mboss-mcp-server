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
