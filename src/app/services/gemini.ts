export { type AuthCredentials, generateCommitMessage, refineCommitMessage, getAuthCredentials };

import { GoogleGenerativeAI, type GenerateContentResponse } from "@google/generative-ai";
import { Future } from "@/libs/future";
import { CommitConvention, type Config, type OAuthTokens } from "@/app/services/config";
import { getAccessToken } from "@/app/services/googleAuth";
import { Just, type Maybe } from "@/libs/maybe";
import { getPrompt } from "@/app/services/prompts";
import { GEMINI_MODEL } from "@/const/gemini-model";

type AuthCredentials =
  | { readonly method: "byok"; readonly apiKey: string }
  | { readonly method: "oauth"; readonly tokens: OAuthTokens };

const getAuthCredentials = (config: Config): Maybe<AuthCredentials> => {
  switch (config.auth_method.type) {
    case "oauth":
      return Just({ method: "oauth", tokens: config.auth_method.content });
    case "api_key":
      return Just({ method: "byok", apiKey: config.auth_method.content });
  }
};

type GenerateContentParams = {
  readonly prompt: string;
  readonly systemInstruction?: string;
};

const generateContentWithApiKey = (apiKey: string, params: GenerateContentParams): Future<Error, string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    ...(params.systemInstruction !== undefined ? { systemInstruction: params.systemInstruction } : {})
  });

  return Future.attemptP(async () => {
    const result = await model.generateContent(params.prompt);
    const text = result.response.text();
    if (!text || !text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej((e) => new Error(String(e)));
};

const generateContentWithOAuth = (tokens: OAuthTokens, params: GenerateContentParams): Future<Error, string> =>
  getAccessToken(tokens).chain((accessToken) =>
    Future.attemptP(async () => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

      const contents = [{ parts: [{ text: params.prompt }] }];
      const body: Record<string, unknown> = { contents };

      if (params.systemInstruction !== undefined) {
        body["system_instruction"] = {
          parts: [{ text: params.systemInstruction }]
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
      }

      const json = (await response.json()) as GenerateContentResponse;

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || !text.trim()) {
        throw new Error("Empty AI response");
      }

      return text.trim();
    }).mapRej((e) => new Error(String(e)))
  );

const generateContent = (auth: AuthCredentials, params: GenerateContentParams): Future<Error, string> => {
  switch (auth.method) {
    case "byok":
      return generateContentWithApiKey(auth.apiKey, params);
    case "oauth":
      return generateContentWithOAuth(auth.tokens, params);
  }
};

const generateCommitMessage = (
  auth: AuthCredentials,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string
): Future<Error, string> =>
  generateContent(auth, {
    prompt: getPrompt(diff, convention, customTemplate)
  });

const refineCommitMessage = (
  auth: AuthCredentials,
  currentMessage: string,
  adjustment: string,
  diff: string
): Future<Error, string> =>
  generateContent(auth, {
    prompt: `<diff>\n${diff}\n</diff>\n<current>\n${currentMessage}\n</current>\n<adjustment>\n${adjustment}\n</adjustment>`,
    systemInstruction:
      "You revise commit messages. Use the diff and the user's adjustment to produce a polished commit message. Preserve required formatting rules: SMALL=single line; MEDIUM/LARGE=title, blank line, bullets prefixed with '- '."
  });
