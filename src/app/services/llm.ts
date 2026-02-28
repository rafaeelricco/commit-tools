export { type GenerateContentParams, generateCommitMessage, refineCommitMessage };

import { Future } from "@/libs/future";
import { type ProviderConfig, type CommitConvention } from "@/app/services/config";
import { generateContentWithGemini } from "@/app/services/gemini";
import { generateContentWithOpenAI } from "@/app/services/openai";
import { getPrompt, getRefinePrompt } from "@/app/services/prompts";

type GenerateContentParams = {
  readonly prompt: string;
  readonly systemInstruction?: string;
};

const generateContent = (config: ProviderConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.provider) {
    case "gemini":
      return generateContentWithGemini(config, params);
    case "openai":
      return generateContentWithOpenAI(config, params);
  }
};

const generateCommitMessage = (
  config: ProviderConfig,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string
): Future<Error, string> =>
  generateContent(config, {
    prompt: getPrompt(diff, convention, customTemplate)
  });

const refineCommitMessage = (
  config: ProviderConfig,
  currentMessage: string,
  adjustment: string,
  diff: string
): Future<Error, string> => generateContent(config, getRefinePrompt({ diff, currentMessage, adjustment }));
