import { GoogleGenerativeAI } from "@google/generative-ai";
import { Future } from "@/future";
import { CommitConvention } from "./config";

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIError";
  }
}

const PRIMARY_MODEL = "gemini-1.5-flash";

/**
 * Generates a commit message using Gemini.
 */
export const generateCommitMessage = (
  apiKey: string,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string
): Future<AIError, string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: PRIMARY_MODEL });

  return Future.attemptP(async () => {
    const prompt = getPrompt(diff, convention, customTemplate);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text.trim()) throw new AIError("Empty AI response");
    return text.trim();
  }).mapRej(e => new AIError(String(e)));
};

/**
 * Refines a commit message based on user feedback.
 */
export const refineCommitMessage = (
  apiKey: string,
  currentMessage: string,
  adjustment: string,
  diff: string
): Future<AIError, string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: PRIMARY_MODEL,
    systemInstruction:
      "You revise commit messages. Use the diff and the user's adjustment to produce a polished commit message. Preserve required formatting rules: SMALL=single line; MEDIUM/LARGE=title, blank line, bullets prefixed with '- '.",
  });

  const prompt = `<diff>\n${diff}\n</diff>\n<current>\n${currentMessage}\n</current>\n<adjustment>\n${adjustment}\n</adjustment>`;

  return Future.attemptP(async () => {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    if (!text.trim()) throw new AIError("Empty AI response during refinement");
    return text.trim();
  }).mapRej(e => new AIError(String(e)));
};

function getPrompt(diff: string, convention: CommitConvention, customTemplate?: string): string {
  switch (convention) {
    case "conventional":
      return promptConventional(diff);
    case "imperative":
      return promptImperative(diff);
    case "custom":
      return promptCustom(diff, customTemplate);
    default:
      return promptImperative(diff);
  }
}

function promptConventional(gitDiff: string): string {
  return `
      <system>
        You are an expert software engineer and version control specialist.
        Your job is to read git diffs and output high-quality commit messages
        that follow Conventional Commits specification.
      </system>

      <rules>
        1. Analyze only the provided diff. Do not guess about unrelated changes.
        2. Classify the change size:
          - SMALL: changes in 1 file, and total changes are minor
                    (e.g. a few lines, small refactor, typo, log tweak, single function change).
          - MEDIUM: multiple files OR a substantial change in 1 file.
          - LARGE: many files and/or broad impact (new features, big refactors, major deletions).
        3. Commit message style (Conventional Commits):
          - Use present-tense, imperative after the type prefix.
          - Prefix with type: feat, fix, refactor, chore, docs, style, test, perf, ci, build
          - Format: type(optional-scope): description
          - Examples: "feat: add user authentication", "fix(api): handle null response"
          - Avoid noise words like "small change" or "minor update".
          - No ticket IDs, no author names, no "WIP".
        4. Output format:
          - For SMALL changes:
            - Output ONLY a single-line summary with type prefix (no body).
          - For MEDIUM or LARGE changes:
            - Line 1: single-line summary with type prefix (title).
            - Line 2: blank line.
            - From line 3 onwards: one or more bullet points,
              each line starting with "- " (dash + space).
        5. Formatting rules for the body (MEDIUM/LARGE only):
          - You MAY use inline code formatting with single backticks, e.g. \`function_name\`, \`git diff\`.
          - Do NOT use multiline code fences (no \`\`\` blocks).
          - Keep language concise and concrete. Prefer what the change DOES over HOW it is implemented.
      </rules>

      <examples>
        <example>
          <git_diff>
            // Single file, few lines
            diff --git a/src/logger.ts b/src/logger.ts
            index 1234567..89abcde 100644
            --- a/src/logger.ts
            +++ b/src/logger.ts
            @@ -10,7 +10,7 @@ export function logInfo(message: string) {{
            -  console.log('[INFO]', message);
            +  console.log('[INFO]', new Date().toISOString(), message);
            }}
          </git_diff>
          <classification>SMALL</classification>
          <commit_message>
            feat(logger): add timestamp to info logs
          </commit_message>
        </example>
      </examples>

      <input>
        <git_diff>
          ${gitDiff}
        </git_diff>
      </input>

      <output_instructions>
        1. First, internally decide if the change is SMALL, MEDIUM, or LARGE.
        2. Do NOT output the classification (SMALL/MEDIUM/LARGE) in your response.
        3. Then output ONLY the final commit message text, with no explanation.
        4. Do NOT wrap the commit message in quotes or code fences.
        5. Always start with a Conventional Commits type prefix and capitalize the first letter after the prefix.
        6. Respect the required format based on size:
          - SMALL: single line only.
          - MEDIUM/LARGE:
            • Line 1: title line with type prefix.
            • Line 2: blank.
            • Remaining lines: each line is a bullet starting with "- ".
      </output_instructions>
`;
}

function promptImperative(gitDiff: string): string {
  return `
      <system>
        You are an expert software engineer and version control specialist.
        Your job is to read git diffs and output high-quality commit messages
        that follow these rules.
      </system>

      <rules>
        1. Analyze only the provided diff. Do not guess about unrelated changes.
        2. Classify the change size:
          - SMALL: changes in 1 file, and total changes are minor
                    (e.g. a few lines, small refactor, typo, log tweak, single function change).
          - MEDIUM: multiple files OR a substantial change in 1 file.
          - LARGE: many files and/or broad impact (new features, big refactors, major deletions).
        3. Commit message style:
          - Use present-tense, imperative in the title (e.g. "add X", "fix Y", "refactor Z").
          - Avoid noise words like "small change" or "minor update".
          - No ticket IDs, no author names, no "WIP".
          - Do NOT use conventional commit prefixes like \`feat:\`, \`fix:\`, \`refactor:\`, \`chore:\`, \`docs:\`, \`style:\`, \`test:\`, \`perf:\`, \`ci:\`, \`build:\`. Start directly with the verb.
        4. Output format:
          - For SMALL changes:
            - Output ONLY a single-line summary (no body).
          - For MEDIUM or LARGE changes:
            - Line 1: single-line summary (title).
            - Line 2: blank line.
            - From line 3 onwards: one or more bullet points,
              each line starting with "- " (dash + space).
        5. Formatting rules for the body (MEDIUM/LARGE only):
          - You MAY use inline code formatting with single backticks, e.g. \`function_name\`, \`git diff\`.
          - Do NOT use multiline code fences (no \`\`\` blocks).
          - Keep language concise and concrete. Prefer what the change DOES over HOW it is implemented.
      </rules>

      <examples>

        <example>
          <git_diff>
            // Single file, few lines
            diff --git a/src/logger.ts b/src/logger.ts
            index 1234567..89abcde 100644
            --- a/src/logger.ts
            +++ b/src/logger.ts
            @@ -10,7 +10,7 @@ export function logInfo(message: string) {{
            -  console.log('[INFO]', message);
            +  console.log('[INFO]', new Date().toISOString(), message);
            }}
          </git_diff>

          <classification>SMALL</classification>
          <commit_message>
            Update info logger to include timestamp
          </commit_message>
        </example>

        <example>
          <git_diff>
            // Multiple files, new function and wiring
            diff --git a/tools/prompting.py b/tools/prompting.py
            index 1111111..2222222 100644
            --- a/tools/prompting.py
            +++ b/tools/prompting.py
            @@ -1,0 +1,40 @@
            +def prompt_commit_message(git_diff: str) -> str:
            +    \"\"\"Generate a commit message prompt from a git diff.\"\"\"
            +    ...

            diff --git a/tests/test_prompting.py b/tests/test_prompting.py
            index 3333333..4444444 100644
            --- a/tests/test_prompting.py
            +++ b/tests/test_prompting.py
            @@ -1,0 +1,25 @@
            +def test_prompt_commit_message():
            +    ...
          </git_diff>

          <classification>MEDIUM</classification>
          <commit_message>
            Add prompt_commit_message function for git diff analysis

            - Add helper to generate commit messages from git diffs following our guidelines.
            - Includes initial implementation of \`prompt_commit_message\` and tests to validate basic usage.
            - ...
          </commit_message>
        </example>

        <negative_example>
          <bad>feat: add user authentication</bad>
          <good>add user authentication</good>
        </negative_example>

      </examples>

      <input>
        <git_diff>
          ${gitDiff}
        </git_diff>
      </input>

      <output_instructions>
        1. First, internally decide if the change is SMALL, MEDIUM, or LARGE
          according to the rules above.
        2. Do NOT output the classification (SMALL/MEDIUM/LARGE) in your response.
        3. Then output ONLY the final commit message text, with no explanation.
        4. Start the commit message with a capital letter.
        5. Do NOT wrap the commit message in quotes or code fences.
        6. Respect the required format based on size:
          - SMALL: single line only.
          - MEDIUM/LARGE:
            • Line 1: title line.
            • Line 2: blank.
            • Remaining lines: each line is a bullet starting with "- ".
        7. Inline code with single backticks is allowed in the bullet points.
      </output_instructions>
`;
}

function promptCustom(gitDiff: string, template?: string): string {
  if (!template) {
    return promptImperative(gitDiff);
  }

  const processedTemplate = template.replace("{diff}", gitDiff);

  return `
      <system>
        You are an expert software engineer and version control specialist.
        Your job is to read git diffs and output high-quality commit messages
        following the user's custom template.
      </system>

      <user_template>
        ${processedTemplate}
      </user_template>

      <output_instructions>
        1. Follow the user's template style and format.
        2. Analyze the content and create a commit message that matches the template pattern.
        3. Output ONLY the final commit message text, with no explanation.
        4. Do NOT wrap the commit message in quotes or code fences.
      </output_instructions>
`;
}
