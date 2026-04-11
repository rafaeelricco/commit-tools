export {
  ANTHROPIC_SETUP_TOKEN_PREFIX,
  ANTHROPIC_SETUP_TOKEN_MIN_LENGTH,
  ANTHROPIC_API_KEY_PREFIX,
  ANTHROPIC_API_KEY_MIN_LENGTH,
  CLAUDE_CLI_VERSION,
  CLAUDE_CODE_SYSTEM_PROMPT,
  anthropicOAuthHeaders,
  validateAnthropicSetupToken,
  validateAnthropicApiKey
};

const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";
const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;
const ANTHROPIC_API_KEY_PREFIX = "sk-ant-api";
const ANTHROPIC_API_KEY_MIN_LENGTH = 20;

const CLAUDE_CLI_VERSION = "2.1.75";

const CLAUDE_CODE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

const anthropicOAuthHeaders = (): Record<string, string> => ({
  "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
  "user-agent": `claude-cli/${CLAUDE_CLI_VERSION}`,
  "x-app": "cli"
});

const validateAnthropicSetupToken = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "Required";
  if (!trimmed.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Expected token starting with ${ANTHROPIC_SETUP_TOKEN_PREFIX}`;
  }
  if (trimmed.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return "Token looks too short; paste the full setup-token";
  }
  return undefined;
};

const validateAnthropicApiKey = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "Required";
  if (!trimmed.startsWith(ANTHROPIC_API_KEY_PREFIX)) {
    return `Expected API key starting with ${ANTHROPIC_API_KEY_PREFIX}`;
  }
  if (trimmed.length < ANTHROPIC_API_KEY_MIN_LENGTH) {
    return "API key looks too short";
  }
  return undefined;
};
