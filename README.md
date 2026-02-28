# commit-tools

[![Version](https://img.shields.io/badge/version-0.1.7-blue.svg)](#)

Writing good commit messages _can_ have a high cognitive cost, especially when you make dozens of commits a day. That energy should be directed toward solving hard problems and shipping features, not summarizing them.

Because of this exhaustion, most commits end up lacking context or good names. This makes it incredibly painful to find out _why_ a change was made months later if you don't have a perfect memory.

While built-in IDE tools (like Cursor, VSCode, or Windsurf) offer basic AI commit generation, they are often inconsistent, lack deep customization, and lock you into their ecosystem.

**commit-tools** is different. We built the only commit assistant that truly understands your workflow needs:

- **Maximum control**: Fine-tune your commits. Demand detailed descriptions, specific formatting, or keep it perfectly brief.
- **Provider freedom**: Bring your own API keys or use your existing subscriptions. We support exactly the LLM you want to use.
- **Universal access**: Works seamlessly anywhere you use the terminal, regardless of what IDE you happen to be in.
- **Crystal-clear history**: Never lose context again. A readable, well-documented commit tree makes it effortless to track down past decisions.

## Quick Install

**Prerequisites:** commit-tools requires the [Bun](https://bun.sh) runtime.

```bash
curl -fsSL https://bun.sh/install | bash
```

```bash
bun install -g @rafaeelricco/commit-tools
# or
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

- **Auth method**: OAuth (sign in with your Google or ChatGPT account) or API Key (paste your own key)
- **Commit convention**: Conventional, Imperative, or Custom

To re-authenticate at any time:

```bash
commit login
```

### 2. Select a Model

After setup, you can switch AI models from your configured provider at any time:

```bash
commit model
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

## Commands

To see all available commands at any time, run:

```bash
commit --help
```

| Command                  | Description                              |
| ------------------------ | ---------------------------------------- |
| `commit`                 | Generate a commit message (default)      |
| `commit generate`        | Generate a commit message                |
| `commit setup`           | Configure authentication and conventions |
| `commit login`           | Alias for setup — re-authenticate        |
| `commit doctor`          | Check installation and environment       |
| `commit model`           | Select a different AI model              |
| `commit --version`, `-v` | Show version                             |
| `commit --help`, `-h`    | Show help                                |

## Providers

- **Google Gemini** — API key or Google OAuth
- **OpenAI** — API key or sign in with your ChatGPT Plus/Pro subscription

More providers coming soon:

- **Anthropic** (Claude)

Contributions and feedback are welcome!

## Contributing

We welcome contributions! Feel free to report bugs, suggest features, or submit pull requests.
