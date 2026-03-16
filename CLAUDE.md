---
description: Use Node.js with tsx/tsup for development and builds.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Node.js with tsx for TypeScript execution and tsup for bundling.

- Use `tsx <file>` instead of `ts-node <file>` for running TypeScript files
- Use `pnpm run build` (tsup) for bundling
- Use `pnpm install` for installing dependencies
- Use `pnpm run <script>` for running scripts
- Use `pnpx <package> <command>` for one-off package execution

## APIs

- Use `node:http` createServer for HTTP servers
- Use `node:fs/promises` for file operations (readFile, writeFile)
- Use `node:child_process` spawn for subprocess execution
- Use `node:crypto` for cryptographic operations

## Build

Use `tsup` for bundling. Configuration is in `tsup.config.ts`.

```bash
pnpm run build
```

## Development

Run TypeScript files directly with tsx:

```bash
tsx index.ts
```

tsx automatically resolves path aliases from `tsconfig.json` (e.g. `@/*` → `./src/*`).
