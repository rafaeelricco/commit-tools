export { type RawResponse, extractResponse, finalizeText };

import { Future } from "@/utils/future";
import { absurd } from "@/utils/types";

const EMPTY_RESPONSE_ERROR = "Empty AI response";

const finalizeText = (raw: string | null | undefined): Future<Error, string> => {
  const trimmed = (raw ?? "").trim();
  return trimmed.length === 0 ? Future.reject(new Error(EMPTY_RESPONSE_ERROR)) : Future.resolve(trimmed);
};

type TextBlock = { type: "text"; text: string };
type AnthropicContent = Array<{ type: string; text?: string }>;

type GeminiSDKLike = { response: { text: () => string | null | undefined } };
type GeminiRESTLike = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

type OpenAIDirectLike = { output_text?: string | null };
type OpenAIStreamLike = {
  response: {
    output: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
    output_text?: string | null;
  };
  doneEventText: string;
  deltaSnapshotText: string;
};

type RawResponse =
  | { provider: "gemini"; source: "sdk"; value: GeminiSDKLike }
  | { provider: "gemini"; source: "rest"; value: GeminiRESTLike }
  | { provider: "anthropic"; value: { content: AnthropicContent } }
  | { provider: "openai"; source: "direct"; value: OpenAIDirectLike }
  | { provider: "openai"; source: "stream"; value: OpenAIStreamLike };

const extractAnthropicText = (content: AnthropicContent): string =>
  content
    .filter((b): b is TextBlock => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

const extractOpenAIStreamText = (raw: OpenAIStreamLike): string => {
  const fromOutput = raw.response.output
    .flatMap((item) => (item.type === "message" ? (item.content ?? []) : []))
    .map((c) => (c.type === "output_text" ? (c.text ?? "") : ""))
    .join("");

  const candidates = [fromOutput, raw.response.output_text ?? "", raw.doneEventText, raw.deltaSnapshotText];
  return candidates.find((v) => v.trim().length > 0) ?? "";
};

const extractResponse = (raw: RawResponse): Future<Error, string> => {
  switch (raw.provider) {
    case "gemini":
      switch (raw.source) {
        case "sdk":
          return finalizeText(raw.value.response.text());
        case "rest":
          return finalizeText(raw.value.candidates?.[0]?.content?.parts?.[0]?.text);
        default:
          return absurd(raw, "RawResponse.gemini");
      }
    case "anthropic":
      return finalizeText(extractAnthropicText(raw.value.content));
    case "openai":
      switch (raw.source) {
        case "direct":
          return finalizeText(raw.value.output_text);
        case "stream":
          return finalizeText(extractOpenAIStreamText(raw.value));
        default:
          return absurd(raw, "RawResponse.openai");
      }
    default:
      return absurd(raw, "RawResponse");
  }
};
