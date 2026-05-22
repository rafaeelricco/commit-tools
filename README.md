# commit-tools

[![Version](https://img.shields.io/badge/version-0.2.6-blue.svg)](#)

Writing good commit messages _can_ have a high cognitive cost, especially when you make dozens of commits a day. That energy should be directed toward solving hard problems and shipping features, not summarizing them.

Because of this exhaustion, most commits end up lacking context or good names. This makes it incredibly painful to find out _why_ a change was made months later if you don't have a perfect memory.

While built-in IDE tools (like Cursor, VSCode, or Windsurf) offer basic AI commit generation, they are often inconsistent, lack deep customization, and lock you into their ecosystem.

**commit-tools** is different. We built the only commit assistant that truly understands your workflow needs:

- **Maximum control**: Fine-tune your commits. Demand detailed descriptions, specific formatting, or keep it perfectly brief.
- **Provider freedom**: Bring your own API keys or use your existing subscriptions. We support exactly the LLM you want to use.
- **Universal access**: Works seamlessly anywhere you use the terminal, regardless of what IDE you happen to be in.
- **Crystal-clear history**: Never lose context again. A readable, well-documented commit tree makes it effortless to track down past decisions.

## Quick Install

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 20

```bash
npm install -g @rafaeelricco/commit-tools
```

## Commit Convention Examples

**Conventional Commits**

```
feat: add model command for selecting AI model
```

```
refactor(config): decouple storage and auth logic

- Separate authentication credentials from configuration storage.
- Introduce `AuthCredentials` type to replace raw API key passing.
- Update `loadConfig` and setup flow to accept a `Dependencies` object.
```

**Imperative Style**

```
Add fuzzy search to model selector
```

```
Refactor commit flow into a class structure

- Extract `CommitFlow` class with dedicated methods for each step.
- Move loading spinner logic to a separate module.
- Update `interactionLoop` to use structured context.
```

**Custom Template**

Define your own format during `commit setup` to match your team's guidelines:

_Template:_

```
[JIRA-<ticket_number>] <gitmoji> <type>(<scope>): <subject>

<optional body>

Co-authored-by: <team_name>
```

_Output:_

```
[JIRA-402] ✨ feat(ui): add model selection command

- Implemented fuzzy search for easier discovery.
- Added a fallback when no models are available.

Co-authored-by: frontend-team
```

## Getting Started

### 1. Setup

Configure your provider, authentication method, and commit convention:

```bash
commit setup
```

You will be prompted to choose:

- **AI provider**: Google Gemini, OpenAI, or Anthropic
- **Auth method**:
  - Google Gemini: Google OAuth or API key
  - OpenAI: Sign in with ChatGPT or API key
  - Anthropic: Claude setup-token or API key
- **Commit convention**: Conventional, Imperative, or Custom

If you want to use your claude.ai subscription with Anthropic, run `claude setup-token` in another terminal first, then paste the generated setup-token during `commit setup`.

To re-authenticate at any time:

```bash
commit login
```

### 2. Select a Model

After setup, you can switch AI models from your configured provider at any time:

```bash
commit model
```

This flow also lets you adjust the reasoning effort for the chosen model. If the model is already the one you want and you only need to change the effort level, run:

```bash
commit effort
```

### 3. Generate a Commit

Stage your changes, then run:

```bash
git add <files> # soon: we will be able to add files using the tool
commit
```

Or explicitly:

```bash
commit generate
```

### System Checks

Verify your installation, environment, and configuration:

```bash
commit doctor
```

### Stay Up to Date

`commit-tools` checks the npm registry once per day and shows a banner when a newer version is available. To install the latest release, run:

```bash
commit update
```

The command auto-detects your global package manager (npm, pnpm, or Yarn 1). Modern Yarn (≥ 2) does not support global installs — use npm or pnpm instead.

To silence the update banner (e.g. for CI or scripted environments), set:

```bash
NO_UPDATE_NOTIFIER=true
```

The banner is also suppressed automatically in non-interactive shells and when `CI=true`.

## Commands

To see all available commands at any time, run:

```bash
commit --help
```

| Command                  | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `commit`                 | Generate a commit message (default)               |
| `commit generate`        | Generate a commit message                         |
| `commit setup`           | Configure authentication and conventions          |
| `commit login`           | Alias for setup — re-authenticate                 |
| `commit doctor`          | Check installation and environment                |
| `commit model`           | Select a different AI model                       |
| `commit effort`          | Adjust the reasoning effort for the current model |
| `commit update`          | Install the latest version from npm               |
| `commit --version`, `-v` | Show version                                      |
| `commit --help`, `-h`    | Show help                                         |

## Providers

- **Google Gemini** — Google OAuth or API key
- **OpenAI** — Sign in with your ChatGPT Plus/Pro subscription or API key
- **Anthropic** (Claude) — Claude setup-token (`claude setup-token`) or API key

Contributions and feedback are welcome!

## Contributing

We welcome contributions! Feel free to report bugs, suggest features, or submit pull requests.

### Pull request checks

Every pull request runs the **PR Validate** workflow (`.github/workflows/pr-validate.yml`):

- **Validate (typecheck, format, build, test)** — typecheck, Prettier, production build, then the full Vitest suite (unit, integration, and CLI smoke tests against `dist/`)
- **Cognitive complexity** — ESLint SonarJS rules
- **Publish preview** — semver / npm publish preview (informational)

Run locally before opening a PR:

```bash
pnpm typecheck
pnpm exec prettier . --check
pnpm build   # requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment
pnpm test
pnpm lint
```

To block merges when checks fail, enable branch protection on `main` and require these status checks:

- `Validate (typecheck, format, build, test)`
- `Cognitive complexity`
