export { getPrompt, getRefinePrompt, getBranchNamePrompt };

import { CommitConvention } from "@/domain/config/config";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { absurd } from "@/libs/types";

function getPrompt(diff: string, convention: CommitConvention, customTemplate: Maybe<string> = Nothing()): string {
  switch (convention) {
    case "conventional":
      return promptConventional(diff);
    case "imperative":
      return promptImperative(diff);
    case "custom":
      return promptCustom(diff, customTemplate);
    default:
      return absurd(convention, "CommitConvention");
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
          - End each bullet with a period for consistency with the project's existing history.
      </rules>

      <examples>
        <example>
          <git_diff>
            // Single file, few lines
            diff --git a/src/logger.ts b/src/logger.ts
            index 1234567..89abcde 100644
            --- a/src/logger.ts
            +++ b/src/logger.ts
            @@ -10,7 +10,7 @@ export function logInfo(message: string) {
            -  console.log('[INFO]', message);
            +  console.log('[INFO]', new Date().toISOString(), message);
            }
          </git_diff>
          <commit_message>
            feat(logger): add timestamp to info logs
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
            +def prompt_commit_message(git_diff: string) -> string:
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
          <commit_message>
            feat(prompting): add prompt_commit_message for git diff analysis

            - Add helper to generate commit messages from git diffs following the project guidelines.
            - Include initial implementation of \`prompt_commit_message\` with unit tests covering basic usage.
            - Wire the helper into the commit flow so diff inputs produce structured prompts.
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
        5. Always start with a Conventional Commits type prefix. Use lowercase for the first word after the prefix (except for proper nouns and acronyms), matching the style of the examples.
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
          - End each bullet with a period for consistency with the project's existing history.
      </rules>

      <examples>

        <example>
          <git_diff>
            // Single file, few lines
            diff --git a/src/logger.ts b/src/logger.ts
            index 1234567..89abcde 100644
            --- a/src/logger.ts
            +++ b/src/logger.ts
            @@ -10,7 +10,7 @@ export function logInfo(message: string) {
            -  console.log('[INFO]', message);
            +  console.log('[INFO]', new Date().toISOString(), message);
            }
          </git_diff>

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
            +def prompt_commit_message(git_diff: string) -> string:
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

function promptCustom(gitDiff: string, template: Maybe<string>): string {
  switch (true) {
    case template instanceof Nothing:
      return promptImperative(gitDiff);
    case template instanceof Just: {
      const processedTemplate = template.value.replace("{diff}", gitDiff);
      return `
      <system>
        You are an expert software engineer and version control specialist.
        Your job is to read git diffs and output high-quality commit messages
        following the user's custom template.
      </system>

      <user_template>
        ${processedTemplate}
      </user_template>

      <git_diff>
        ${gitDiff}
      </git_diff>

      <output_instructions>
        1. Follow the user's template style and format.
        2. Analyze the content and create a commit message that matches the template pattern.
        3. Output ONLY the final commit message text, with no explanation.
        4. Do NOT wrap the commit message in quotes or code fences.
      </output_instructions>
`;
    }
    default:
      template satisfies never;
      return promptImperative(gitDiff);
  }
}

function getBranchNamePrompt(context: string): string {
  return `
      <system>
        You are an expert software engineer and version control specialist.
        Your job is to read local git change context (diff plus status) and propose
        three short branch names that describe the work in plain language.
        Your entire reply must be one JSON object and nothing else.
      </system>

      <machine_contract>
        After stripping leading and trailing whitespace on your reply, the first character must be "{" and the last character must be "}".
        Do not print markdown code fences, do not print bullet lists, do not print explanations before or after the JSON.
        Use this exact key name: "suggestions" (array of exactly three strings).
        Target shape (replace placeholders only): {"suggestions":["<slug>","<slug>","<slug>"]}
        Each slug must match this regular expression alone: ^[a-z0-9]+(-[a-z0-9]+)*$
      </machine_contract>

      <rules>
        1. Analyze only the provided change context. Do not guess about work not shown.
        2. Output exactly three distinct suggestions, ordered from most to least specific.
        3. Grounding: each slug must be clearly derivable from the change context (for example
           file path segments, symbol or component names, or domain nouns that appear in the diff or status).
           If you cannot tie a slug to the context, pick a shorter slug that still reflects visible paths or identifiers.
        4. Each suggestion is a single path segment: one flat kebab-case slug only.
           No slashes. No username, owner, team, or machine namespace prefix.
           Do not start the slug with a conventional change-type label (for example
           feat, fix, chore, docs, refactor, test, perf, build, ci, feature, bugfix,
           hotfix, release) as its own first word before a hyphen or as the entire name.
           Describe the work itself (nouns / actions in neutral wording), not the category of change.
        5. Use lowercase ASCII letters, digits, and single hyphens between word groups.
           No underscores, no spaces, no uppercase, no dots, no slashes.
        6. Do not use consecutive hyphens (--) or leading/trailing hyphens.
        7. Keep each name concise (aim under roughly 50 characters). Avoid vague words like "update",
           "changes", "wip", "tmp", or the literal substring "branch".
        8. Forbidden vocabulary in any slug (substring match, case-insensitive): suggestion, suggestions,
           prompt, llm, model, cli, tool, tools, command, commands, workflow, meta, git-switch, branch-name.
           Do not name branches after this assistant, prompts, models, CLIs, or git mechanics.
        9. Do not include ticket or issue IDs unless they appear explicitly in the provided context.
        10. Never suggest trunk-style branch names: main, master, develop, HEAD.
        11. Self-check before you answer: each slug matches ^[a-z0-9]+(-[a-z0-9]+)*$, contains none of the forbidden
            substrings above, and is grounded in the change context. If any check fails, revise internally until it passes,
            then output only the final JSON object.
      </rules>

      <examples>
        <example>
          <context>diff shows new login form component and tests</context>
          <json>{"suggestions":["login-form-component","login-flow-ui","auth-form-tests"]}</json>
        </example>
        <example>
          <context>diff shows fix for null dereference in parser</context>
          <json>{"suggestions":["parser-null-guard","null-deref-parser","parser-hardening"]}</json>
        </example>
        <example type="invalid_do_not_emit">
          <context>same as above</context>
          <bad_json>{"suggestions":["name-suggestion-cli","local-change-name-suggestions","git-switch-name-suggestions"]}</bad_json>
          <reason>These slugs describe tooling or meta work, not the code change. Never emit this pattern.</reason>
        </example>
      </examples>

      <input>
        <change_context>
          ${context}
        </change_context>
      </input>

      <output_instructions>
        1. Output ONLY a single JSON object. First non-whitespace character "{", last non-whitespace character "}".
        2. No markdown fences, no commentary, no keys other than "suggestions".
        3. Schema: {"suggestions":["<slug>","<slug>","<slug>"]} with exactly three strings; each slug must satisfy the machine_contract regex and all rules.
      </output_instructions>
  `;
}

function getRefinePrompt(params: { diff: string; currentMessage: string; adjustment: string }): {
  prompt: string;
  systemInstruction: string;
} {
  return {
    prompt:
      `<diff>\n${params.diff}\n</diff>\n` + `<current>\n${params.currentMessage}\n</current>\n` + `<adjustment>\n${params.adjustment}\n</adjustment>`,
    systemInstruction:
      "You revise commit messages. Use the diff and the user's adjustment to produce a polished commit message. " +
      "Preserve required formatting rules: SMALL=single line; MEDIUM/LARGE=title, blank line, bullets prefixed with '- '. " +
      "Preserve the original convention: if the current message starts with a Conventional Commits prefix (feat, fix, refactor, chore, docs, style, test, perf, ci, build), keep it; otherwise keep the imperative style. " +
      "Output ONLY the revised commit message. No preamble, no explanation, no code fences, no surrounding quotes."
  };
}
