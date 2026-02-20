export { executeSetupFlow };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { saveConfig } from "@/app/storage";
import { CommitConvention, type AuthMethod, type Config, performOAuthFlow, validateOAuthTokens } from "@/app/services/googleAuth";
import { type Dependencies } from "@/app/integrations";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Just, Nothing } from "@/libs/maybe";

import color from "picocolors";

const executeSetupFlow = (deps: Dependencies): Future<Error, void> => {
  return Future.attemptP(async () => {
    p.intro(color.bgCyan(color.black(" Commit Gen Setup ")));

    const convention = await p.select({
      message: "Select commit convention:",
      options: [
        { value: "conventional", label: "Conventional (feat:, fix:)" },
        { value: "imperative", label: "Imperative (add, fix, update)" },
        { value: "custom", label: "Custom template" },
      ],
      initialValue: "imperative",
    });

    if (p.isCancel(convention)) throw new Error("Setup cancelled");

    let customTemplate: string | undefined;
    if (convention === "custom") {
      const template = await p.text({
        message: "Enter custom template (use {diff} as placeholder):",
        validate: value => (!value || !value.includes("{diff}") ? "Template must include {diff}" : undefined),
      });
      if (p.isCancel(template)) throw new Error("Setup cancelled");
      customTemplate = template;
    }

    const authMethod = await p.select({
      message: "Select authentication method:",
      options: [
        { value: "oauth", label: "Google OAuth (recommended)", hint: "Opens browser for Google sign-in" },
        { value: "api_key", label: "API Key", hint: "Paste a Google AI Studio API key" },
      ],
      initialValue: "oauth",
    });

    if (p.isCancel(authMethod)) throw new Error("Setup cancelled");

    return {
      convention: convention as CommitConvention,
      customTemplate,
      authMethod: authMethod as AuthMethod,
    };
  }).chain(({ convention, customTemplate, authMethod }) => {
    switch (authMethod) {
      case "oauth":
        return setupOAuth(deps, convention, customTemplate);
      case "api_key":
        return setupApiKey(convention, customTemplate);
    }
  });
};

const setupOAuth = (
  deps: Dependencies,
  convention: CommitConvention,
  customTemplate: string | undefined,
): Future<Error, void> => {
  p.log.info("Opening browser for Google sign-in...");

  return performOAuthFlow(deps)
    .chain(tokens => {
      const s = p.spinner();
      s.start("Validating OAuth tokens...");

      return validateOAuthTokens(tokens)
        .chain(() => {
          s.stop("OAuth tokens validated!");

          const config: Config = {
            auth_method: { type: "oauth", content: tokens },
            commit_convention: convention,
            custom_template: customTemplate ? Just(customTemplate) : Nothing(),
          };

          return saveConfig(config);
        })
        .map(() => {
          p.outro(color.green("Setup complete! Authenticated via Google OAuth."));
        })
        .mapRej(e => {
          s.stop(color.red("OAuth validation failed."));
          return e;
        });
    })
    .mapRej(e => {
      p.log.error(color.red(e.message));
      return e;
    });
};

const setupApiKey = (
  convention: CommitConvention,
  customTemplate: string | undefined,
): Future<Error, void> =>
  Future.attemptP(async () => {
    const apiKey = await p.password({
      message: "Enter your GOOGLE_API_KEY:",
      validate: value => (!value || value.length < 10 ? "API Key is too short" : undefined),
    });

    if (p.isCancel(apiKey)) throw new Error("Setup cancelled");
    return apiKey;
  }).chain(apiKey => {
    const s = p.spinner();
    s.start("Validating API key...");

    return validateApiKey(apiKey)
      .chain(() => {
        s.stop("API key validated!");

        const config: Config = {
          auth_method: { type: "api_key", content: apiKey },
          commit_convention: convention,
          custom_template: customTemplate ? Just(customTemplate) : Nothing(),
        };

        return saveConfig(config);
      })
      .map(() => {
        p.outro(color.green("Setup complete!"));
      })
      .mapRej(e => {
        s.stop(color.red("Validation failed."));
        return e;
      });
  });

const validateApiKey = (apiKey: string): Future<Error, void> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });
  return Future.attemptP(async () => {
    await model.generateContent("test");
  });
};
