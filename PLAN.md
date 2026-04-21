# Add reasoning "effort" selection across all providers (SDK-first)

## Context

`commit-tools` lets users pick a model per provider (Gemini, OpenAI, Anthropic) but always calls the API with default reasoning settings. Modern reasoning models expose a user-tunable "effort" knob. Instead of modelling this ourselves with string enums and prefix allow-lists, **we derive every effort value from the official SDK types** and **defer model-capability detection to runtime** (try the SDK-typed param; on API 400 about `reasoning`/`thinking`, degrade gracefully; cache the outcome on the config so we never ask twice for the same model).

No regex. No prefix lists. No hand-maintained "does model X support reasoning" map. SDKs are the single source of truth for what values are valid; the API is the single source of truth for whether the chosen model accepts them.

### What each SDK already gives us (verified by reading the installed `.d.ts`)

| Provider | SDK (installed) | Effort types exposed |
|---|---|---|
| OpenAI | `openai@6.25.0`  — [node_modules/openai/resources/shared.d.ts:143-193](node_modules/openai/resources/shared.d.ts#L143-L193) | `interface Reasoning { effort?: ReasoningEffort \| null; summary?: ... }`<br>`type ReasoningEffort = 'none' \| 'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh' \| null` |
| Anthropic | `@anthropic-ai/sdk@0.87.0` — [node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:708-1023](node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts#L708-L1023) | `interface OutputConfig { effort?: 'low' \| 'medium' \| 'high' \| 'max' \| null; format?: ... }`<br>`type ThinkingConfigParam = ThinkingConfigEnabled \| ThinkingConfigDisabled \| ThinkingConfigAdaptive`<br>`interface ThinkingConfigAdaptive { type: 'adaptive'; display?: ... }`<br>`interface ThinkingConfigEnabled { type: 'enabled'; budget_tokens: number; display?: ... }` |
| Google | **`@google/genai` (to install, replaces deprecated `@google/generative-ai@0.24.1`)** | `interface ThinkingConfig { thinkingBudget?: number; thinkingLevel?: ThinkingLevel; includeThoughts?: boolean; }`<br>`type ThinkingLevel = 'LOW' \| 'MEDIUM' \| 'HIGH'` (with `MINIMAL` on Gemini 3 Flash)  |

**Critical observation:** none of the three SDKs expose a machine-readable "does model X support reasoning?" predicate. That data lives on the API side. We therefore treat capability as a **runtime property** — try, observe, remember.

### Decisions confirmed by the user

1. **Runtime fallback + cache** for capability detection (no hardcoded tables, no regex).
2. **Migrate `@google/generative-ai` → `@google/genai`** bundled in this PR (EOL 2025-08-31 on the old SDK anyway).
3. Storage uses `Maybe<T>` per `CONVENTIONS.md`. Effort types are **per-provider**, each pinned to the SDK's own type unions.
4. Slider UI appears after model selection in both `cli/model.ts` and `cli/setup.ts`. If the cache says "unsupported on this model", the slider is skipped silently.

---

## 0. Dependency change

- [package.json](package.json)
  - Remove: `"@google/generative-ai": "^0.24.1"` (deprecated, EOL 2025-08-31).
  - Add: `"@google/genai": "^1.x"` (pin at install time to the latest stable).
- Run `pnpm install` to refresh the lockfile.
- Update all `@google/generative-ai` imports in the repo: currently only [src/infra/llm/gemini.ts:3](src/infra/llm/gemini.ts#L3) (`GoogleGenerativeAI`). Rewrite the api_key branch to use `@google/genai`'s `GoogleGenAI` and `ai.models.generateContent({ model, contents, config: { ... } })` shape (see §6 below).

## 1. Domain — config schema (per-provider, SDK-typed)

- [src/domain/config/config.ts](src/domain/config/config.ts)
  - Add three effort types, each **pinned to the SDK's own type** with `satisfies` so TypeScript breaks the build if the SDK ever drops a value.
  - Add `effort_support` cache field per provider so we never re-probe a known-unsupported model.

```ts
// src/domain/config/config.ts  (additions)
import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { ThinkingLevel } from "@google/genai";

// --- Value types: taken straight from SDK unions ----------------------------

export type OpenAIEffort    = NonNullable<OpenAI.Reasoning["effort"]>;
// 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type AnthropicEffort = NonNullable<Anthropic.OutputConfig["effort"]>;
// 'low' | 'medium' | 'high' | 'max'

export type GeminiEffort    = ThinkingLevel;
// 'LOW' | 'MEDIUM' | 'HIGH' (+ MINIMAL on Gemini 3 Flash)

// --- Runtime value lists (mirror the SDK unions, verified by `satisfies`) ---
// These are the *only* hand-authored string lists in the whole feature, and
// the `satisfies` clauses ensure they stay aligned with the SDK unions.

const OPENAI_EFFORTS    = ["none", "minimal", "low", "medium", "high", "xhigh"] as const satisfies readonly OpenAIEffort[];
const ANTHROPIC_EFFORTS = ["low", "medium", "high", "max"]                       as const satisfies readonly AnthropicEffort[];
const GEMINI_EFFORTS    = ["MINIMAL", "LOW", "MEDIUM", "HIGH"]                   as const satisfies readonly GeminiEffort[];

// --- Capability cache -------------------------------------------------------
// Populated by the runtime fallback chain after the first generate call.

export type EffortSupport =
  | { kind: "unknown" }                              // model just selected, no probe yet
  | { kind: "supported" }                            // last generate accepted effort
  | { kind: "unsupported"; reason: string };         // API rejected effort; remember so we don't ask

const schema_EffortSupport = s.discriminatedUnion([
  s.variant({ kind: "unknown" as const }),
  s.variant({ kind: "supported" as const }),
  s.variant({ kind: "unsupported" as const, reason: s.string })
]);

// --- ProviderConfig variants: effort is SDK-typed, per provider ------------

const schema_ProviderConfig = s.discriminatedUnion([
  s.variant({
    provider: "openai",
    model: s.string,
    auth_method: schema_AuthMethod,
    effort: s.optionalMaybe(s.stringEnum([...OPENAI_EFFORTS])),     // Maybe<OpenAIEffort>
    effort_support: s.optionalMaybe(schema_EffortSupport)           // Maybe<EffortSupport>
  }),
  s.variant({
    provider: "anthropic",
    model: s.string,
    auth_method: schema_AuthMethod,
    effort: s.optionalMaybe(s.stringEnum([...ANTHROPIC_EFFORTS])),  // Maybe<AnthropicEffort>
    effort_support: s.optionalMaybe(schema_EffortSupport)
  }),
  s.variant({
    provider: "gemini",
    model: s.string,
    auth_method: schema_AuthMethod,
    effort: s.optionalMaybe(s.stringEnum([...GEMINI_EFFORTS])),     // Maybe<GeminiEffort>
    effort_support: s.optionalMaybe(schema_EffortSupport)
  })
]);
```

**Why `s.optionalMaybe` (not `s.maybe`)** — verified against the library and the project's own precedent:

| Primitive | Source (schema.ts) | Key required in JSON? | `Nothing` encodes as… | `Just(v)` encodes as… |
|---|---|---|---|---|
| `s.maybe(x)` | [line 158](src/libs/json/schema.ts#L158) | **Yes** (required) | `{ nothing: true }`-ish (via `E.maybe`, per [CONVENTIONS.md:290](CONVENTIONS.md#L290) which explicitly says "**Don't use `E.maybe()` for optional fields — it produces `{ just: V }` structure**") | `{ just: v }` wrapper |
| `s.optionalMaybe(x)` | [line 118](src/libs/json/schema.ts#L118) | **No** (optional) | key **omitted entirely** | raw inner value |

Three concrete reasons `s.optionalMaybe` wins here:

1. **Backward compatibility**: existing users' `~/.commit-tools/config.json` has no `effort` / `effort_support` field. With `s.maybe`, the decoder would reject those files on startup (the key is mandatory). With `s.optionalMaybe`, missing → `Nothing()`.
2. **Clean stored JSON**: `s.maybe` produces `"effort": { "just": "high" }` in the on-disk config, which is noisy; `s.optionalMaybe` produces `"effort": "high"` (or omits when `Nothing`).
3. **Existing project precedent**: this exact file already uses [`custom_template: s.optionalMaybe(s.string)`](src/domain/config/config.ts#L85) for the same semantic ("optional user-set value"). Grep confirms **zero uses of `s.maybe` in `src/`** — it's the right primitive for mandatory `Maybe<T>` fields deep inside data structures, not for top-level config flags.

`s.maybe` would be the right tool if we were, for example, modelling a discriminated-union variant's `result: Maybe<T>` field where every record-of-that-type must carry the field. That's not our shape.

Both consumers still see the exact same TypeScript type (`Maybe<Effort>`) — the only difference is on-disk format and back-compat.

## 2. Domain — effort translators (new file)

- [src/domain/llm/effort.ts](src/domain/llm/effort.ts) — **no capability detection**. Just three tiny functions that wrap the user's SDK-typed value into the correct SDK-typed request param, plus a small fallback mapper for Anthropic's adaptive→enabled degrade and Gemini's level→budget degrade.

```ts
// src/domain/llm/effort.ts
export {
  openaiReasoningParam,
  anthropicAdaptiveParam,
  anthropicEnabledParam,
  geminiLevelConfig,
  geminiBudgetConfig
};

import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { ThinkingConfig } from "@google/genai";
import type { OpenAIEffort, AnthropicEffort, GeminiEffort } from "@/domain/config/config";
import { type Maybe } from "@/libs/maybe";

// OpenAI: trivial pass-through — the SDK type IS our storage type.
const openaiReasoningParam = (effort: Maybe<OpenAIEffort>): Pick<OpenAI.Responses.ResponseCreateParams, "reasoning"> | undefined =>
  effort.maybe(undefined, (e) => ({ reasoning: { effort: e } satisfies OpenAI.Reasoning }));

// Anthropic — preferred (adaptive) path. Pure wrap in SDK types.
const anthropicAdaptiveParam = (effort: Maybe<AnthropicEffort>):
  Pick<Anthropic.MessageCreateParams, "thinking" | "output_config"> | undefined =>
    effort.maybe(undefined, (e) => ({
      thinking: { type: "adaptive" } satisfies Anthropic.ThinkingConfigAdaptive,
      output_config: { effort: e } satisfies Anthropic.OutputConfig
    }));

// Anthropic — fallback (enabled + budget_tokens) path. Used only when the API
// rejects the adaptive shape (older Claude models, or Claude Code backend).
// The effort→tokens mapping is documented as a graceful-degradation fallback,
// NOT as capability detection — the user's semantic choice is preserved.
const BUDGET_BY_EFFORT: Record<AnthropicEffort, number> = {
  low: 1024, medium: 4096, high: 16384, max: 24576
};
const anthropicEnabledParam = (effort: Maybe<AnthropicEffort>, baseMaxTokens: number):
  { thinking: Anthropic.ThinkingConfigEnabled; max_tokens: number } | undefined =>
    effort.maybe(undefined, (e) => {
      const budget = BUDGET_BY_EFFORT[e];
      return {
        thinking: { type: "enabled", budget_tokens: budget } satisfies Anthropic.ThinkingConfigEnabled,
        max_tokens: Math.max(baseMaxTokens, budget + 1024)     // SDK requires max_tokens > budget_tokens
      };
    });

// Gemini — preferred (thinkingLevel) path for Gemini 3.
const geminiLevelConfig = (effort: Maybe<GeminiEffort>): { thinkingConfig: ThinkingConfig } | undefined =>
  effort.maybe(undefined, (e) => ({ thinkingConfig: { thinkingLevel: e } }));

// Gemini — fallback (thinkingBudget) path for Gemini 2.5.
const BUDGET_BY_LEVEL: Record<GeminiEffort, number> = {
  MINIMAL: 128, LOW: 512, MEDIUM: 2048, HIGH: 8192
};
const geminiBudgetConfig = (effort: Maybe<GeminiEffort>): { thinkingConfig: ThinkingConfig } | undefined =>
  effort.maybe(undefined, (e) => ({ thinkingConfig: { thinkingBudget: BUDGET_BY_LEVEL[e] } }));
```

Every return type (`OpenAI.Reasoning`, `Anthropic.ThinkingConfigAdaptive`, `Anthropic.ThinkingConfigEnabled`, `@google/genai`'s `ThinkingConfig`) is directly an SDK type. The `satisfies` keyword ensures any SDK change breaks the build.

## 3. Infra — runtime fallback chain

- [src/infra/llm/effort-fallback.ts](src/infra/llm/effort-fallback.ts) — new module. Provides a generic "try with effort, on specific 400 strip/downgrade, on success mark supported, on failure mark unsupported with reason" wrapper around each provider's send.

```ts
// src/infra/llm/effort-fallback.ts
export { tryWithEffort, type EffortAttempt, type EffortResult };

import { Future } from "@/libs/future";
import type { EffortSupport } from "@/domain/config/config";

// An EffortAttempt is a function that runs ONE request variant. Provider
// adapters supply an ordered list: richest shape first, empty shape last.
type EffortAttempt<T> = () => Future<Error, T>;

type EffortResult<T> = { value: T; support: EffortSupport };

// Predicate: is this error the API telling us the effort shape is unsupported
// for this model? Matches known signals without hardcoding model IDs.
const isEffortRejection = (err: Error): boolean => {
  const msg = err.message;
  return /reasoning|thinking|thinking_config|output_config|budget_tokens/i.test(msg)
    && /(400|invalid_request|unsupported_parameter|bad_request)/i.test(msg);
};

// Try attempts in order. The LAST attempt (stripped) is always run on failure
// so the user's generate never hard-fails just because effort was unsupported.
const tryWithEffort = <T>(attempts: [EffortAttempt<T>, ...EffortAttempt<T>[]]): Future<Error, EffortResult<T>> => {
  const [first, ...rest] = attempts;

  const walk = (n: number, fn: EffortAttempt<T>, remaining: EffortAttempt<T>[]): Future<Error, EffortResult<T>> =>
    fn().map<EffortResult<T>>((value) => ({
      value,
      support: n === 0 ? { kind: "supported" } : { kind: "unsupported", reason: `Degraded at attempt ${n}` }
    })).chainRej((err) => {
      if (!isEffortRejection(err) || remaining.length === 0) return Future.reject(err);
      const [next, ...tail] = remaining;
      return walk(n + 1, next, tail);
    });

  return walk(0, first, rest);
};
```

The returned `EffortResult` carries the new `EffortSupport` value so the caller can persist it to config.

## 4. Infra — UI effort slider (Ink, horizontal, colored)

Layout and controls per the screenshots you provided (no separate "selected indicator" row — selection = colored bold label + ▲ on the rail directly above it).

### 4a. Slider component

- [src/infra/ui/effort-slider.tsx](src/infra/ui/effort-slider.tsx) — new Ink component, same style as [src/infra/ui/model-selector.tsx](src/infra/ui/model-selector.tsx). Split handlers to respect the `sonarjs/cognitive-complexity: 10` threshold from [eslint.config.js](eslint.config.js).

```tsx
// src/infra/ui/effort-slider.tsx (key shape)
export { EffortSlider, type EffortSliderProps };

import * as React from "react";
import { Box, Text, useInput, useApp, type Key } from "ink";
import chalk from "chalk";

type EffortSliderProps = {
  title: string;
  options: readonly string[];        // SDK-typed string values, rendered in order
  initialIndex: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

const PALETTE = {
  6: ["yellow", "green", "cyan", "blueBright", "magenta", "red"],
  5: ["yellow", "green", "cyan", "magenta", "red"],
  4: ["yellow", "green", "magenta", "red"],
  3: ["yellow", "green", "red"],
  2: ["yellow", "red"]
} as const;

const paletteFor = (n: number): readonly string[] =>
  (PALETTE as Record<number, readonly string[]>)[n] ?? PALETTE[6];

const EffortSlider = ({ title, options, initialIndex, onSubmit, onCancel }: EffortSliderProps) => {
  const { exit } = useApp();
  const [index, setIndex] = React.useState(Math.max(0, Math.min(options.length - 1, initialIndex)));

  const handleLifecycle = (key: Key): boolean => {
    if (key.escape) { onCancel(); exit(); return true; }
    if (key.return) { onSubmit(options[index]); exit(); return true; }
    return false;
  };
  const handleNavigation = (key: Key): boolean => {
    if (key.leftArrow)  { setIndex((i) => Math.max(0, i - 1));                  return true; }
    if (key.rightArrow) { setIndex((i) => Math.min(options.length - 1, i + 1)); return true; }
    return false;
  };
  useInput((_input, key) => { if (handleLifecycle(key)) return; handleNavigation(key); });

  const cols = Math.min(72, Math.max(40, (process.stdout.columns ?? 72) - 4));
  const palette = paletteFor(options.length);
  const step = options.length > 1 ? Math.floor(cols / (options.length - 1)) : 0;
  const markerCol = index * step;

  const rail = Array.from({ length: cols })
    .map((_, c) => (c === markerCol ? (chalk as Record<string, (s: string) => string>)[palette[index]]!("▲") : chalk.dim("─")))
    .join("");

  const labels = options
    .map((o, i) => {
      const color = palette[i] ?? "gray";
      const fn = (chalk as Record<string, { bold: (s: string) => string } & ((s: string) => string)>)[color]!;
      return i === index ? fn.bold(o) : chalk.gray(o);
    })
    .join("    ");

  return (
    <Box flexDirection="column">
      <Box><Text color="cyan">◆ </Text><Text>{title}</Text></Box>
      <Box><Text color="gray">│</Text></Box>
      <Box>
        <Text color="gray">│  </Text>
        <Text color="gray">Speed</Text>
        <Text>{" ".repeat(Math.max(1, cols - "Speed".length - "Intelligence".length))}</Text>
        <Text color="gray">Intelligence</Text>
      </Box>
      <Box><Text color="gray">│  </Text><Text>{rail}</Text></Box>
      <Box><Text color="gray">│  </Text><Text>{labels}</Text></Box>
      <Box><Text color="gray">│</Text></Box>
      <Box><Text color="gray">│  </Text><Text color="gray">Use ◀ ▶ to adjust • Enter to confirm • Esc to cancel</Text></Box>
    </Box>
  );
};
```

### 4b. Picker wrapper

- [src/infra/ui/effort-picker.ts](src/infra/ui/effort-picker.ts) — Future/dynamic-import wrapper. Dispatches to the provider's SDK-typed option list. Does **not** check capability itself — the only thing that skips the prompt is a cached `effort_support.kind === "unsupported"` on the config.

```ts
// src/infra/ui/effort-picker.ts
export { selectEffortInteractively };

import { Future } from "@/libs/future";
import { Nothing, type Maybe } from "@/libs/maybe";
import type { ProviderConfig } from "@/domain/config/config";

// SDK-driven option arrays (from config.ts, verified by `satisfies` against
// the SDK type unions).
const OPTIONS_BY_PROVIDER = {
  openai:    ["none", "minimal", "low", "medium", "high", "xhigh"] as const,
  anthropic: ["low", "medium", "high", "max"]                       as const,
  gemini:    ["MINIMAL", "LOW", "MEDIUM", "HIGH"]                   as const
} as const;

const DEFAULT_INDEX = { openai: 3, anthropic: 2, gemini: 3 } as const;

const selectEffortInteractively = (config: ProviderConfig): Future<Error, Maybe<string>> => {
  // Cached "unsupported" → skip silently.
  if (config.effort_support.maybe(false, (s) => s.kind === "unsupported")) {
    return Future.resolve(Nothing<string>());
  }

  const options = OPTIONS_BY_PROVIDER[config.provider];
  const current = config.effort.maybe<string | null>(null, (v) => v);
  const initialIndex = current === null ? DEFAULT_INDEX[config.provider] : options.indexOf(current as never);

  return Future.attemptP(async () => {
    const { render } = await import("ink");
    const React = await import("react");
    const { EffortSlider } = await import("@/infra/ui/effort-slider");
    const { Just, Nothing } = await import("@/libs/maybe");

    return new Promise<Maybe<string>>((resolve, reject) => {
      const { unmount } = render(
        React.createElement(EffortSlider, {
          title: `Reasoning effort for ${config.model}`,
          options,
          initialIndex: Math.max(0, initialIndex),
          onSubmit: (v) => { unmount(); resolve(Just(v)); },
          onCancel: () => { unmount(); reject(new Error("Selection cancelled")); }
        })
      );
    });
  });
};
```

### 4c. UI mockups (per provider)

**OpenAI (`gpt-5-mini`, 6 options — the full `OpenAI.ReasoningEffort` enum):**
```
◆  Reasoning effort for gpt-5-mini
│
│   Speed                                                    Intelligence
│   ──────────────────────────────▲────────────────────────────────────
│    none     minimal     low     medium     high     xhigh
│
│   Use ◀ ▶ to adjust • Enter to confirm • Esc to cancel
```
(`none` yellow, `minimal` green, `low` cyan, `medium` blueBright [selected/bold], `high` magenta, `xhigh` red.)

**Anthropic (`claude-opus-4-6`, 4 options from `Anthropic.OutputConfig.effort`):**
```
◆  Reasoning effort for claude-opus-4-6
│
│   Speed                                                    Intelligence
│   ──────────────────────────────────────────▲──────────────────────
│    low           medium         high         max
```
(`low` yellow, `medium` green, `high` magenta [selected/bold], `max` red. Same UI on Claude 3.7 / 4 / 4.5 — we preserve the user's semantic choice and let runtime fallback convert to `budget_tokens` if the API rejects adaptive.)

**Gemini (`gemini-2.5-pro` OR `gemini-3-pro-preview`, 4 options from `@google/genai`'s `ThinkingLevel`):**
```
◆  Reasoning effort for gemini-3-pro-preview
│
│   Speed                                                    Intelligence
│   ────────────────────────────────────────────────────────▲────────
│    MINIMAL        LOW         MEDIUM         HIGH
```
(Gemini 2.5 Pro receives the same UI — user picks a level; runtime fallback maps to `thinkingBudget` if `thinkingLevel` is rejected on 2.5.)

**After a successful generate marks the model as `unsupported`** (runtime says no): next `commit-tools model` invocation silently skips the slider. Manual override available via a follow-up `commit-tools effort --reset` (out of scope for this PR).

## 5. CLI — model & setup commands

- [src/cli/model.ts](src/cli/model.ts) — add effort selection right after model picker, then persist both fields:

```ts
// src/cli/model.ts (run method)
run(): Future<Error, void> {
  p.intro(color.bgCyan(color.black(" Change Model ")));

  return loading("Fetching available models...", "Models fetched!",
      fetchModels(this.providerConfig.provider, this.providerConfig.auth_method))
    .chain((models) => selectModelInteractively(models))
    .chain((modelId) =>
      // Model changed → reset effort_support to "unknown"; we'll re-learn on next generate.
      selectEffortInteractively({
        ...this.config.ai,
        model: modelId,
        effort_support: Just({ kind: "unknown" as const })
      })
        .map((effort) => ({ modelId, effort }))
    )
    .chain(({ modelId, effort }) =>
      saveConfig({
        ...this.config,
        ai: withModelAndEffort(this.config.ai, modelId, effort)
      })
    )
    .map(() => { p.outro(color.green("Model updated successfully!")); })
    .mapRej((e) => { p.log.error(color.red(e.message)); return e; });
}
```

`withModelAndEffort` is a tiny exhaustive helper next to `run`:
```ts
const withModelAndEffort = (
  current: ProviderConfig, modelId: string, effort: Maybe<string>
): ProviderConfig => {
  const reset = Just({ kind: "unknown" as const });
  switch (current.provider) {
    case "openai":    return { ...current, model: modelId, effort: effort as Maybe<OpenAIEffort>,    effort_support: reset };
    case "anthropic": return { ...current, model: modelId, effort: effort as Maybe<AnthropicEffort>, effort_support: reset };
    case "gemini":    return { ...current, model: modelId, effort: effort as Maybe<GeminiEffort>,    effort_support: reset };
    default:          return absurd(current, "ProviderConfig");
  }
};
```

- [src/cli/setup.ts](src/cli/setup.ts) — same insertion: after model selection (~line 163), before save.

## 6. Infra — provider adapters (SDK-typed, runtime-fallback)

### 6a. OpenAI — [src/infra/llm/openai.ts](src/infra/llm/openai.ts)

```ts
// Chain: with reasoning → without reasoning (if API rejects).
const runWithOpenAI = (
  mk: (withReasoning: boolean) => Future<Error, string>,
  effort: Maybe<OpenAIEffort>
): Future<Error, EffortResult<string>> =>
  tryWithEffort<string>(
    effort.maybe<[EffortAttempt<string>, ...EffortAttempt<string>[]]>(
      [() => mk(false)],                          // no effort stored → just run
      () => [() => mk(true), () => mk(false)]     // try with, then without
    )
  );

// api_key branch
const callOpenAIWithApiKey = (authToken: string, model: string, effort: Maybe<OpenAIEffort>, params: GenerateContentParams) => {
  const mk = (withReasoning: boolean) => Future.attemptP(async () => {
    const client = new OpenAI({ apiKey: authToken });
    const base: OpenAI.Responses.ResponseCreateParams = {
      model,
      instructions: params.systemInstruction ?? null,
      input: params.prompt
    };
    const paramsOut = withReasoning ? { ...base, ...openaiReasoningParam(effort) } : base;
    return await client.responses.create(paramsOut);
  }).mapRej(toError).chain((r) => extractResponse({ provider: "openai", source: "direct", value: r }));
  return runWithOpenAI(mk, effort);
};

// Codex-OAuth branch has the same pattern; the same tryWithEffort handles its 4xx fallback.
```

### 6b. Anthropic — [src/infra/llm/anthropic.ts](src/infra/llm/anthropic.ts)

Three-step fallback: `adaptive` → `enabled`+`budget_tokens` → no thinking. Uses the SDK-typed variants we defined in §2.

```ts
const callAnthropicWithApiKey = (apiKey: string, model: string, effort: Maybe<AnthropicEffort>, params: GenerateContentParams) => {
  const mk = (stage: "adaptive" | "enabled" | "off") => Future.attemptP(async () => {
    const client = new Anthropic({ apiKey });
    const base: Anthropic.MessageCreateParams = {
      model, max_tokens: 4096,
      ...(params.systemInstruction !== undefined ? { system: params.systemInstruction } : {}),
      messages: [{ role: "user", content: params.prompt }]
    };
    const paramsOut: Anthropic.MessageCreateParams =
      stage === "adaptive" ? { ...base, ...anthropicAdaptiveParam(effort) }
      : stage === "enabled" ?
          (() => {
            const ep = anthropicEnabledParam(effort, 4096);
            return ep ? { ...base, thinking: ep.thinking, max_tokens: ep.max_tokens } : base;
          })()
      : base;
    return await client.messages.create(paramsOut);
  }).mapRej(toError).chain((r) => extractResponse({ provider: "anthropic", value: r }));

  return tryWithEffort<string>(
    effort.maybe<[EffortAttempt<string>, ...EffortAttempt<string>[]]>(
      [() => mk("off")],
      () => [() => mk("adaptive"), () => mk("enabled"), () => mk("off")]
    )
  );
};
```

The Claude Code OAuth path (`anthropic_setup_token`) uses the **same** fallback chain — if the backend rejects adaptive because the beta header isn't enabled, it falls through to `enabled` cleanly. No special-casing of auth_method.

### 6c. Gemini — [src/infra/llm/gemini.ts](src/infra/llm/gemini.ts)

**Rewritten to use `@google/genai`** (the deprecated SDK is swapped). Fallback chain: `thinkingLevel` (Gemini 3 style) → `thinkingBudget` (Gemini 2.5 style) → no thinking.

```ts
// api_key branch — rewritten to @google/genai
import { GoogleGenAI, type ThinkingConfig } from "@google/genai";

const callGeminiWithApiKey = (apiKey: string, model: string, effort: Maybe<GeminiEffort>, params: GenerateContentParams) => {
  const mk = (stage: "level" | "budget" | "off") => Future.attemptP(async () => {
    const ai = new GoogleGenAI({ apiKey });
    const config: Record<string, unknown> = {};
    if (params.systemInstruction !== undefined) config.systemInstruction = params.systemInstruction;
    if (stage === "level")  Object.assign(config, geminiLevelConfig(effort));
    if (stage === "budget") Object.assign(config, geminiBudgetConfig(effort));
    return await ai.models.generateContent({
      model,
      contents: params.prompt,
      config
    });
  }).mapRej(toError).chain((r) => extractResponse({ provider: "gemini", source: "sdk", value: r }));

  return tryWithEffort<string>(
    effort.maybe<[EffortAttempt<string>, ...EffortAttempt<string>[]]>(
      [() => mk("off")],
      () => [() => mk("level"), () => mk("budget"), () => mk("off")]
    )
  );
};

// OAuth REST branch: same fallback, just builds `generationConfig.thinkingConfig` into the JSON body.
```

### 6d. Persisting the capability result

Each adapter returns `Future<Error, EffortResult<string>>` instead of `Future<Error, string>`. [src/domain/llm/router.ts](src/domain/llm/router.ts) catches the result, hands the string back to [src/domain/commit/commit.ts](src/domain/commit/commit.ts) for the user-facing output, and writes the new `effort_support` value back into config via `saveConfig`. Exactly one `saveConfig` call per generate; it's a cheap JSON write.

## 7. Verification

1. **Build + lint + typecheck**: `pnpm run build && pnpm run typecheck && pnpm run lint:ci` — all clean. The `satisfies readonly OpenAIEffort[]` clauses must compile against the installed SDK's types.
2. **Schema back-compat**: existing `~/.commit-tools/config.json` (no `effort`/`effort_support`) loads; the `optionalMaybe` decoder yields `Nothing()`; generate still works with zero behaviour change.
3. **Slider values match SDK**:
   - `model` on OpenAI shows **exactly** `none / minimal / low / medium / high / xhigh`.
   - On Anthropic shows **exactly** `low / medium / high / max`.
   - On Gemini shows **exactly** `MINIMAL / LOW / MEDIUM / HIGH`.
4. **Runtime fallback (per provider)** — run one real commit generation against each matrix row and inspect the effective request payload + the persisted `effort_support`:
   - OpenAI api_key + `gpt-5-mini` + effort=`high` → request has `reasoning: { effort: "high" }`, config shows `supported`.
   - OpenAI api_key + `gpt-4o` + effort=`high` → request fails on 400, retries without `reasoning`, commit still generated, config shows `unsupported` with reason; next `commit-tools model` on same model skips slider.
   - Anthropic api_key + `claude-opus-4-6` + effort=`max` → request has `thinking: { type: "adaptive" }` + `output_config: { effort: "max" }`, config `supported`.
   - Anthropic api_key + `claude-sonnet-4-5` + effort=`max` → adaptive fails → retries with `enabled + budget_tokens: 24576`, succeeds, config `supported` (different shape, same semantic).
   - Anthropic setup_token + `claude-opus-4-6` + effort=`max` → adaptive may fail (no beta header) → falls through to `enabled`, commits succeed.
   - Gemini api_key + `gemini-3-pro-preview` + effort=`HIGH` → request has `thinkingConfig.thinkingLevel: "HIGH"`, `supported`.
   - Gemini api_key + `gemini-2.5-pro` + effort=`HIGH` → level rejected → retries with `thinkingBudget: 8192`, succeeds, `supported`.
   - Gemini OAuth + `gemini-1.5-pro-latest` + any effort → both level and budget rejected → retries without thinking, succeeds, `unsupported`.
5. **Persistence**: confirm `~/.commit-tools/config.json` now contains `effort: { just: "high" }` and `effort_support: { just: { kind: "supported" } }` (or equivalent encoded form) after each scenario.
6. **Doctor**: `commit-tools doctor` prints the effort field cleanly.

## 8. Out of scope

- A dedicated `commit-tools effort` / `commit-tools effort --reset` subcommand (trivial follow-up once this lands; re-running `commit-tools model` already refreshes both fields).
- Anthropic `thinking.display: "summarized" | "omitted"` control — not exposed; we pass the SDK's default.
- Gemini `includeThoughts` toggle — we never surface thinking tokens to the user in commit output.
- Exact budget integers for power users (Anthropic `budget_tokens` / Gemini `thinkingBudget`) — we only map semantic tiers; a separate advanced prompt could add it later.
- Migrating the OAuth REST Gemini path entirely to `@google/genai` (the SDK exposes an OAuth-token client too, but the existing REST call keeps the diff smaller; a follow-up can consolidate).
