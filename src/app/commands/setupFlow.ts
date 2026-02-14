import * as p from "@clack/prompts";
import color from "picocolors";
import { Future } from "@/future";
import { saveConfig, CommitConvention } from "../config";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const executeSetupFlow = (): Future<Error, void> => {
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

    const apiKey = await p.password({
      message: "Enter your GOOGLE_API_KEY:",
      validate: value => (!value || value.length < 10 ? "API Key is too short" : undefined),
    });

    if (p.isCancel(apiKey)) throw new Error("Setup cancelled");

    return {
      api_key: apiKey,
      commit_convention: convention as CommitConvention,
      custom_template: customTemplate,
    };
  }).chain(config => {
    const s = p.spinner();
    s.start("Validating API key...");
    
    return validateApiKey(config.api_key)
      .chain(() => {
        s.stop("API key validated!");
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
};

const validateApiKey = (apiKey: string): Future<Error, void> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  return Future.attemptP(async () => {
    await model.generateContent("test");
  });
};
