export { Setup };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { saveConfig } from "@/app/storage";
import { CommitConvention, DEFAULT_MODELS, type Config, type ProviderConfig } from "@/app/services/config";
import { performOAuthFlow, validateOAuthTokens } from "@/app/services/googleAuth";
import { Dependencies } from "@/app/integrations";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Just, Nothing } from "@/libs/maybe";
import { loading } from "@/app/ui";

import color from "picocolors";

type SetupPreferences = {
  readonly convention: CommitConvention;
  readonly customTemplate: string | undefined;
  readonly provider: ProviderConfig["provider"];
  readonly model: string;
  readonly authMethod: "oauth" | "api_key";
};

class Setup {
  private constructor(
    private readonly deps: Dependencies,
    private readonly preferences: SetupPreferences
  ) {}

  static create(deps: Dependencies): Future<Error, Setup> {
    return Future.attemptP(async () => {
      p.intro(color.bgCyan(color.black(" Commit Gen Setup ")));

      const provider = await p.select({
        message: "Select AI provider:",
        options: [{ value: "gemini", label: "Google Gemini" }],
        initialValue: "gemini"
      });

      if (p.isCancel(provider)) throw new Error("Setup cancelled");

      const defaultModel = DEFAULT_MODELS[provider as ProviderConfig["provider"]];

      const model = await p.text({
        message: "Enter model ID:",
        initialValue: defaultModel,
        placeholder: defaultModel
      });

      if (p.isCancel(model)) throw new Error("Setup cancelled");

      const convention = await p.select({
        message: "Select commit convention:",
        options: [
          { value: "conventional", label: "Conventional (feat:, fix:)" },
          { value: "imperative", label: "Imperative (add, fix, update)" },
          { value: "custom", label: "Custom template" }
        ],
        initialValue: "imperative"
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
        options: [
          {
            value: "oauth",
            label: "Google OAuth (recommended)",
            hint: "Opens browser for Google sign-in"
          },
          {
            value: "api_key",
            label: "API Key",
            hint: "Paste a Google AI Studio API key"
          }
        ],
        initialValue: "oauth"
      });

      if (p.isCancel(authMethod)) throw new Error("Setup cancelled");

      return new Setup(deps, {
        convention: convention as CommitConvention,
        customTemplate,
        provider: provider as ProviderConfig["provider"],
        model: model as string,
        authMethod: authMethod as "oauth" | "api_key"
      });
    });
  }

  run(): Future<Error, void> {
    switch (this.preferences.authMethod) {
      case "oauth":
        return this.setupOAuth();
      case "api_key":
        return this.setupApiKey();
    }
  }

  private buildConfig(authMethod: ProviderConfig["auth_method"]): Config {
    return {
      ai: {
        provider: this.preferences.provider,
        model: this.preferences.model,
        auth_method: authMethod
      },
      commit_convention: this.preferences.convention,
      custom_template: this.preferences.customTemplate ? Just(this.preferences.customTemplate) : Nothing()
    };
  }

  private setupOAuth(): Future<Error, void> {
    p.log.info("Opening browser for Google sign-in...");

    return performOAuthFlow(this.deps)
      .chain((tokens) =>
        loading("Validating OAuth tokens...", "OAuth tokens validated!", validateOAuthTokens(tokens)).map(() =>
          this.buildConfig({ type: "oauth", content: tokens })
        )
      )
      .chain((config) => saveConfig(config))
      .map(() => {
        p.outro(color.green("Setup complete! Authenticated via Google OAuth."));
      })
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }

  private setupApiKey(): Future<Error, void> {
    return Future.attemptP(async () => {
      const apiKey = await p.password({
        message: "Enter your GOOGLE_API_KEY:",
        validate: (value) => (!value || value.length < 10 ? "API Key is too short" : undefined)
      });

      if (p.isCancel(apiKey)) throw new Error("Setup cancelled");
      return apiKey;
    }).chain((apiKey) =>
      loading("Validating API key...", "API key validated!", Setup.validateApiKey(apiKey, this.preferences.model))
        .map(() => this.buildConfig({ type: "api_key", content: apiKey }))
        .chain((config) => saveConfig(config))
        .map(() => {
          p.outro(color.green("Setup complete!"));
        })
        .mapRej((e) => {
          p.log.error(color.red("Validation failed."));
          return e;
        })
    );
  }

  private static validateApiKey(apiKey: string, model: string): Future<Error, void> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });
    return Future.attemptP(async () => {
      await geminiModel.generateContent("test");
    });
  }
}
