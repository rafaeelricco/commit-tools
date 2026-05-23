# commit-tools — agent integration

This document describes the machine-readable CLI contract for LLM agents and automation.

## Commands

| Intent | Command |
|--------|---------|
| Generate message | `commit generate --json` |
| Generate + commit | `commit generate --json --commit` |
| Generate + commit + push | `commit generate --json --commit --push` |
| Refine + preview | `commit generate --json --adjust "shorter subject" --dry-run` |
| Health check | `commit doctor --json` |

Flags can appear without the `generate` subcommand when they start with `--json`:

```bash
commit --json --commit
```

## stdout / stderr

- **Success:** one JSON object on **stdout** (no extra lines, no ANSI).
- **Failure:** `{ "ok": false, "error": { "code", "message" } }` on **stderr**, exit code `1`.
- Progress spinners are suppressed in `--json` mode.

## Generate flags

| Flag | Requires | Effect |
|------|----------|--------|
| `--json` | — | Enable machine mode (no interactive prompts) |
| `--adjust <text>` | `--json` | Refine the message once before output/git actions |
| `--dry-run` | `--json` | Run LLM only; do not commit or push |
| `--commit` | `--json` | Commit with the generated message |
| `--push` | `--json`, `--commit` | Push after commit |
| `--yes` | `--push` | Publish branch or force-with-lease without confirm |

## Error codes

| Code | Meaning |
|------|---------|
| `INVALID_FLAGS` | Invalid or incompatible flag combination |
| `NOT_GIT_REPO` | Not inside a git repository |
| `NO_STAGED_CHANGES` | No staged changes to commit |
| `NO_CONFIG` | Missing config (run `commit setup` first) |
| `AUTH_FAILED` | Provider authentication failed |
| `LLM_ERROR` | LLM provider error |
| `PUSH_NO_UPSTREAM` | No upstream branch (use `--yes` or `git push -u`) |
| `PUSH_REJECTED` | Non-fast-forward push rejected (use `--yes` for force-with-lease) |

## generate success JSON

```json
{
  "ok": true,
  "command": "generate",
  "message": "feat: example",
  "actions": {
    "adjusted": false,
    "committed": false,
    "pushed": false,
    "dryRun": false
  },
  "metadata": {
    "durationMs": 1200,
    "model": { "provider": "openai", "model": "gpt-4.1-mini", "effort": "medium" },
    "tokens": null
  },
  "commit": null
}
```

After `--commit`, `commit` contains hash, short, subject, authorName, authorEmail, and date (ISO 8601).

## doctor success JSON

```json
{
  "ok": true,
  "command": "doctor",
  "checks": [
    { "name": "CLI Version", "status": "ok", "level": "ok", "info": "@rafaeelricco/commit-tools 0.x" }
  ],
  "ready": true,
  "elapsedMs": 42
}
```

Schema definitions live in `src/cli/json-io.ts`.
