export { xaiApiKeyOptions, XAI_API_BASE_URL };

import type { ClientOptions } from "openai";

const XAI_API_BASE_URL = "https://api.x.ai/v1";

/** xAI's API is OpenAI-compatible, so the `openai` client serves it with only a `baseURL` change. */
const xaiApiKeyOptions = (apiKey: string): ClientOptions => ({ baseURL: XAI_API_BASE_URL, apiKey, maxRetries: 3, timeout: 120_000 });
