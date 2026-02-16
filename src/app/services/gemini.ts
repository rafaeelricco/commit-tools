import { GoogleGenerativeAI } from "@google/generative-ai";
import { Future } from "@/libs/future";
import { CommitConvention, type Config, type OAuthTokens, getAccessToken } from "@/app/services/googleAuth";
import { getPrompt } from "@/app/services/prompts";

const GEMINI_MODEL = "gemini-flash-lite-latest";
const GEMINI_REST_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type AuthCredentials =
  | { readonly method: "api_key"; readonly apiKey: string }
  | { readonly method: "oauth"; readonly tokens: OAuthTokens };

export const getAuthCredentials = (config: Config): AuthCredentials | null => {
  if (config.auth_method === "oauth" && config.tokens !== undefined) {
    return { method: "oauth", tokens: config.tokens };
  }
  if (config.api_key !== undefined) {
    return { method: "api_key", apiKey: config.api_key };
  }
  return null;
};

type GenerateContentParams = {
  readonly prompt: string;
  readonly systemInstruction?: string;
};

const generateContentWithApiKey = (
  apiKey: string,
  params: GenerateContentParams,
): Future<Error, string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    ...(params.systemInstruction !== undefined ? { systemInstruction: params.systemInstruction } : {}),
  });

  return Future.attemptP(async () => {
    const result = await model.generateContent(params.prompt);
    const text = result.response.text();
    if (!text || !text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej(e => new Error(String(e)));
};

type GeminiRestResponse = {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{
        readonly text?: string;
      }>;
    };
  }>;
  readonly error?: {
    readonly message?: string;
    readonly code?: number;
  };
};

const generateContentWithOAuth = (
  tokens: OAuthTokens,
  params: GenerateContentParams,
): Future<Error, string> =>
  getAccessToken(tokens).chain(accessToken =>
    Future.attemptP(async () => {
      const url = `${GEMINI_REST_BASE}/${GEMINI_MODEL}:generateContent`;

      const contents = [{ parts: [{ text: params.prompt }] }];
      const body: Record<string, unknown> = { contents };

      if (params.systemInstruction !== undefined) {
        body["system_instruction"] = {
          parts: [{ text: params.systemInstruction }],
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
      }

      const json = await response.json() as GeminiRestResponse;

      if (json.error) {
        throw new Error(`Gemini API error: ${json.error.message ?? "Unknown error"}`);
      }

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || !text.trim()) {
        throw new Error("Empty AI response");
      }

      return text.trim();
    }).mapRej(e => new Error(String(e)))
  );

const generateContent = (
  auth: AuthCredentials,
  params: GenerateContentParams,
): Future<Error, string> => {
  switch (auth.method) {
    case "api_key":
      return generateContentWithApiKey(auth.apiKey, params);
    case "oauth":
      return generateContentWithOAuth(auth.tokens, params);
  }
};

export const generateCommitMessage = (
  auth: AuthCredentials,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string,
): Future<Error, string> =>
  generateContent(auth, {
    prompt: getPrompt(diff, convention, customTemplate),
  });

export const refineCommitMessage = (
  auth: AuthCredentials,
  currentMessage: string,
  adjustment: string,
  diff: string,
): Future<Error, string> =>
  generateContent(auth, {
    prompt: `<diff>\n${diff}\n</diff>\n<current>\n${currentMessage}\n</current>\n<adjustment>\n${adjustment}\n</adjustment>`,
    systemInstruction:
      "You revise commit messages. Use the diff and the user's adjustment to produce a polished commit message. Preserve required formatting rules: SMALL=single line; MEDIUM/LARGE=title, blank line, bullets prefixed with '- '.",
  });
