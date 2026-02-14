import { GoogleGenerativeAI } from "@google/generative-ai";
import { Future } from "@/future";
import { CommitConvention } from "@domain/config/schema";
import { getPrompt } from "@domain/commit/prompts";

const PRIMARY_MODEL = "gemini-1.5-flash";

/**
 * Generates a commit message using Gemini.
 */
export const generateCommitMessage = (
  apiKey: string,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string
): Future<Error, string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: PRIMARY_MODEL });

  return Future.attemptP(async () => {
    const prompt = getPrompt(diff, convention, customTemplate);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text || !text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej(e => new Error(String(e)));
};

/**
 * Refines a commit message based on user feedback.
 */
export const refineCommitMessage = (
  apiKey: string,
  currentMessage: string,
  adjustment: string,
  diff: string
): Future<Error, string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: PRIMARY_MODEL,
    systemInstruction:
      "You revise commit messages. Use the diff and the user's adjustment to produce a polished commit message. Preserve required formatting rules: SMALL=single line; MEDIUM/LARGE=title, blank line, bullets prefixed with '- '.",
  });

  const prompt = `<diff>\n${diff}\n</diff>\n<current>\n${currentMessage}\n</current>\n<adjustment>\n${adjustment}\n</adjustment>`;

  return Future.attemptP(async () => {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text || !text.trim()) throw new Error("Empty AI response during refinement");
    return text.trim();
  }).mapRej(e => new Error(String(e)));
};
