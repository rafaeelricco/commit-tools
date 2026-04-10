export { Setup };

import * as p from "@clack/prompts";
import type { Option } from "@clack/prompts";

import { Future } from "@/libs/future";
import { saveConfig } from "@/lib/storage/config";
import { CommitConvention, type Config, type ProviderConfig } from "@/domain/config/config";
import { performOAuthFlow, validateOAuthTokens } from "@/lib/auth/google";
import { performOpenAIOAuthFlow, validateOpenAITokens } from "@/lib/auth/openai";
import { validateAnthropicApiKey, validateAnthropicSetupToken } from "@/lib/auth/anthropic";
import { Just, Nothing } from "@/libs/maybe";
import { loading } from "@/lib/ui/spinner";
import { fetchModels, selectModelInteractively } from "@/domain/commit/model";

import color from "picocolors";

type SetupPreferences = {
  readonly convention: CommitConvention;
  readonly customTemplate: string | undefined;
  readonly provider: ProviderConfig["provider"];
  readonly authMethod: "google_oauth" | "openai_oauth" | "api_key" | "anthropic_setup_token";
};

class Setup {
  private constructor(private readonly preferences: SetupPreferences) {}

  static create(): Future<Error, Setup> {
    return Future.attemptP(async () => {
      p.intro(color.bgCyan(color.black(" Commit Gen Setup ")));

      const provider = await p.select({
        message: "Select AI provider:",
        options: [
          { value: "gemini", label: "Google" },
          { value: "openai", label: "OpenAI" },
          { value: "anthropic", label: "Anthropic" }
        ],
        initialValue: "gemini" as const
      });

      if (p.isCancel(provider)) throw new Error("Setup cancelled");

      const convention = await p.select({
        message: "Select commit convention:",
        options: [
          { value: "conventional", label: "Conventional (feat:, fix:)" },
          { value: "imperative", label: "Imperative (add, fix, update)" },
          { value: "custom", label: "Custom template" }
        ],
        initialValue: "imperative" as const
      });

      if (p.isCancel(convention)) throw new Error("Setup cancelled");

      let customTemplate: string | undefined;
      if (convention === "custom") {
        const template = await p.text({
          message: "Enter custom template (use {diff} as placeholder):",
          validate: (value) => (!value || !value.includes("{diff}") ? "Template must include {diff}" : undefined)
        });
        if (p.isCancel(template)) throw new Error("Setup cancelled");
        customTemplate = template;
      }

      const authMethod = await p.select({
        message: "Select authentication method:",
        options: getAuthMethodOptions(provider),
        initialValue: getInitialValue(provider)
      });

      if (p.isCancel(authMethod)) throw new Error("Setup cancelled");

      return new Setup({
        convention: convention,
        customTemplate,
        provider: provider,
        authMethod: authMethod
      });
    });
  }

  run(): Future<Error, void> {
    switch (this.preferences.authMethod) {
      case "google_oauth":
        return this.setupOAuth();
      case "openai_oauth":
        return this.setupOpenAIOAuth();
      case "anthropic_setup_token":
        return this.setupAnthropicSetupToken();
      case "api_key":
        return this.setupApiKey();
    }
  }

  private buildConfig(authMethod: ProviderConfig["auth_method"], model: string): Config {
    return {
      ai: {
        provider: this.preferences.provider,
        model,
        auth_method: authMethod
      },
      commit_convention: this.preferences.convention,
      custom_template: this.preferences.customTemplate ? Just(this.preferences.customTemplate) : Nothing()
    };
  }

  private setupOAuth(): Future<Error, void> {
    p.log.info("Opening browser for Google sign-in...");

    return performOAuthFlow()
      .chain((tokens) =>
        loading("Validating OAuth tokens...", "OAuth tokens validated!", validateOAuthTokens(tokens)).map(() => ({
          type: "google_oauth" as const,
          content: tokens
        }))
      )
      .chain((authMethod) => this.finalizeSetup(authMethod));
  }

  private setupOpenAIOAuth(): Future<Error, void> {
    p.log.info("Opening browser for ChatGPT sign-in...");

    return performOpenAIOAuthFlow()
      .chain((tokens) =>
        loading("Validating tokens...", "Tokens validated!", validateOpenAITokens(tokens)).map(() => ({
          type: "openai_oauth" as const,
          content: tokens
        }))
      )
      .chain((authMethod) => this.finalizeSetup(authMethod));
  }

  private setupApiKey(): Future<Error, void> {
    const { message, validate } = apiKeyPromptFor(this.preferences.provider);
    return Future.attemptP(async () => {
      const apiKey = await p.password({ message, validate });
      if (p.isCancel(apiKey)) throw new Error("Setup cancelled");
      return apiKey.trim();
    }).chain((apiKey) => this.finalizeSetup({ type: "api_key" as const, content: apiKey }));
  }

  private setupAnthropicSetupToken(): Future<Error, void> {
    p.log.info("Run `claude setup-token` in another terminal to generate a token from your claude.ai subscription.");
    return Future.attemptP(async () => {
      const token = await p.password({
        message: "Paste your Claude setup-token (sk-ant-oat01-...):",
        validate: validateAnthropicSetupToken
      });

      if (p.isCancel(token)) throw new Error("Setup cancelled");
      return token.trim();
    }).chain((token) => this.finalizeSetup({ type: "anthropic_setup_token" as const, content: token }));
  }

  private finalizeSetup(authMethod: ProviderConfig["auth_method"]): Future<Error, void> {
    return loading(
      "Fetching available models...",
      "Models fetched!",
      fetchModels(this.preferences.provider, authMethod)
    )
      .chain((models) => selectModelInteractively(models))
      .chain((modelId) => saveConfig(this.buildConfig(authMethod, modelId)))
      .map(() => {
        p.outro(color.green("Setup complete!"));
      })
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }
}

function getAuthMethodOptions(provider: ProviderConfig["provider"]): Option<SetupPreferences["authMethod"]>[] {
  switch (provider) {
    case "openai":
      return [
        {
          value: "openai_oauth",
          label: "Sign in with ChatGPT (recommended)",
          hint: "Uses your ChatGPT Plus/Pro subscription"
        },
        {
          value: "api_key",
          label: "API Key",
          hint: "Paste an OpenAI API key"
        }
      ];
    case "gemini":
      return [
        {
          value: "google_oauth",
          label: "Google OAuth (recommended)",
          hint: "Opens browser for Google sign-in"
        },
        {
          value: "api_key",
          label: "API Key",
          hint: "Paste a Google AI Studio API key"
        }
      ];
    case "anthropic":
      return [
        {
          value: "anthropic_setup_token",
          label: "Claude Setup-Token (recommended)",
          hint: "Uses your claude.ai subscription — run `claude setup-token`"
        },
        {
          value: "api_key",
          label: "API Key",
          hint: "Paste an Anthropic API key (sk-ant-api...)"
        }
      ];
  }
}

function getInitialValue(provider: ProviderConfig["provider"]): SetupPreferences["authMethod"] {
  switch (provider) {
    case "openai":
      return "openai_oauth";
    case "gemini":
      return "google_oauth";
    case "anthropic":
      return "anthropic_setup_token";
  }
}

type ApiKeyPrompt = {
  readonly message: string;
  readonly validate: (value: string | undefined) => string | undefined;
};

const genericApiKeyValidator = (value: string | undefined): string | undefined =>
  !value || value.length < 10 ? "API Key is too short" : undefined;

function apiKeyPromptFor(provider: ProviderConfig["provider"]): ApiKeyPrompt {
  switch (provider) {
    case "openai":
      return { message: "Enter your OPENAI_API_KEY:", validate: genericApiKeyValidator };
    case "gemini":
      return { message: "Enter your GOOGLE_API_KEY:", validate: genericApiKeyValidator };
    case "anthropic":
      return { message: "Enter your ANTHROPIC_API_KEY (sk-ant-api...):", validate: validateAnthropicApiKey };
  }
}
