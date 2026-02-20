# commit-tools

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](#)
[![Built with Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](#)

![commit-tools Screenshot](./docs/assets/screenshot.png)

commit-tools is an open-source AI assistant that brings the power of Gemini directly
into your terminal to generate high-quality git commit messages. It provides
lightweight access to Gemini, giving you the most direct path from your staged
changes to a meaningful, well-formatted commit message.

## Why commit-tools?

- **Interactive Refinement**: Generate, review, adjust, or regenerate commit messages interactively before committing.
- **Flexible Conventions**: Choose between conventional commits (`feat:`, `fix:`), imperative style (`add`, `fix`), or create your own custom template.
- **Multiple Authentication Options**: Sign in with your Google account via OAuth, or use a Gemini API key.
- **Built-in System Checks**: Easily verify your installation, environment, and authentication token validity using the `doctor` command.
- **Terminal-first**: Designed for developers who live in the command line and prefer rapid, keyboard-driven workflows.

## Installation

### Install globally with bun

```bash
# From the project directory
bun link
```

## Authentication Options

Choose the authentication method that best fits your needs:

### Option 1: Login with Google (OAuth)

**Best for:** Individual developers.

**Benefits:**

- Free tier execution relying on Gemini APIs.
- No API key management - just sign in with your Google account.
- Automatic token refresh handled by the tool.

Run the tool and choose _Google OAuth (recommended)_ when prompted during setup:

```bash
commit-tools setup
```

### Option 2: Gemini API Key

**Best for:** Developers who prefer API keys or have specific limits.

Run the setup and choose _API Key_, then paste your Gemini API key from Google AI Studio:

```bash
commit-tools setup
```

## Getting Started

### Initial Setup

Configure your preferred authentication and commit convention:

```bash
commit-tools setup
```

### Basic Usage

Stage your changes in your git repository:

```bash
git add <files>
```

Generate a commit message based on your staged changes:

```bash
commit-tools generate
```

Or simply use the default command:

```bash
commit-tools
```

### System Checks

Check your installation, environment, and configuration status:

```bash
commit-tools doctor
```

## Contributing

We welcome contributions! Feel free to report bugs, suggest features, or submit pull requests to help improve the tool.

## Legal

- **License**: Open Source.

---

<p align="center">
  Built by the open source community
</p>
