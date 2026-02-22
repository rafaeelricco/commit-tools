# commit-tools

[![Version](https://img.shields.io/badge/version-0.1.2-blue.svg)](#)

Writing good commit messages _can_ have a high cognitive cost, especially when you make dozens of commits a day. That energy should be directed toward solving hard problems and shipping features, not summarizing them.

Because of this exhaustion, most commits end up lacking context or good names. This makes it incredibly painful to find out _why_ a change was made months later if you don't have a perfect memory.

While built-in IDE tools (like Cursor, VSCode, or Windsurf) offer basic AI commit generation, they are often inconsistent, lack deep customization, and lock you into their ecosystem.

**commit-tools** is different. We built the only commit assistant that truly understands your workflow needs:

- **Maximum control**: Fine-tune your commits. Demand detailed descriptions, specific formatting, or keep it perfectly brief.
- **Provider freedom**: Bring your own API keys or use your existing subscriptions. We support exactly the LLM you want to use.
- **Universal access**: Works seamlessly anywhere you use the terminal, regardless of what IDE you happen to be in.
- **Crystal-clear history**: Never lose context again. A readable, well-documented commit tree makes it effortless to track down past decisions.

## Quick Install

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

Define your own format during `commit setup` to match your team's guidelines.

## Getting Started

### 1. Setup

Configure your provider, authentication method, and commit convention:

```bash
commit setup
```

You will be prompted to choose:

- **Auth method**: OAuth (sign in with your account) or BYOK (paste your own API key)
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
git add <files>
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

Currently powered by **Google Gemini**. More providers are coming soon:

- **OpenAI** (GPT-4o, o1, o3, etc.)
- **Anthropic** (Claude)

Contributions and feedback are welcome!

## Contributing

We welcome contributions! Feel free to report bugs, suggest features, or submit pull requests.

## Legal

- **License**: Open Source.

---

<p align="center">
  Built by the open source community
</p>
