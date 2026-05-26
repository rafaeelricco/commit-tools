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
        Read the work snapshot below (git diff, status lines, and any new file bodies)
        and propose three short branch names that describe that work.
        Reply with one JSON object only.
      </system>

      <output_format>
        First non-whitespace character must be "{". Last non-whitespace character must be "}".
        No markdown fences, no bullet lists, no text before or after the JSON.
        Required shape: {"suggestions":["<slug>","<slug>","<slug>"]}
        Each slug: lowercase ASCII, digits, single hyphens between words, no slashes.
        Pattern each slug must satisfy: ^[a-z0-9]+(-[a-z0-9]+)*$
      </output_format>

      <rules>
        1. Use only the work snapshot below. Do not guess about work not shown.
        2. Output exactly three distinct slugs, ordered from most to least specific.
        3. Ground every slug in the snapshot: file paths, symbols, components, or domain nouns
           that appear in the diff, status lines, or untracked file sections.
           Prefer tokens copied or condensed from those paths and identifiers.
        4. One flat slug per suggestion. No slashes, no username or team prefix.
           Do not start with change-type labels (feat, fix, chore, docs, refactor, test, perf,
           build, ci, feature, bugfix, hotfix, release) as the first word or as the whole slug.
        5. No underscores, spaces, uppercase, dots, or consecutive hyphens.
        6. Keep each slug under roughly 50 characters. Avoid vague words: update, changes, wip, tmp, branch.
        7. Never reuse wording from these instructions in a slug. Forbidden substrings (anywhere in a slug):
           suggestion, suggestions, prompt, llm, model, cli, tool, tools, command, commands, workflow, meta,
           git-switch, branch-name, local-change, name-picker, kebab-case, machine-contract, snapshot, context.
        8. Do not include ticket or issue IDs unless they appear in the snapshot.
        9. Never suggest trunk names: main, master, develop, HEAD.
        10. Before answering, verify each slug matches the output_format pattern, avoids forbidden substrings,
            and is grounded in the snapshot. Revise internally if needed, then output only the JSON object.
      </rules>

      <examples>
        <example>
          <work_snapshot>diff shows new login form component and tests under src/auth/</work_snapshot>
          <json>{"suggestions":["login-form-component","auth-login-flow","auth-form-tests"]}</json>
        </example>
        <example>
          <work_snapshot>diff shows null guard in parser module</work_snapshot>
          <json>{"suggestions":["parser-null-guard","null-deref-parser","parser-hardening"]}</json>
        </example>
        <example type="invalid_do_not_emit">
          <work_snapshot>same as above</work_snapshot>
          <bad_json>{"suggestions":["name-suggestion-cli","local-change-name-picker","kebab-case-validation"]}</bad_json>
          <reason>These slugs echo tooling or instruction words, not the code change. Never emit this pattern.</reason>
        </example>
      </examples>

      <work_snapshot>
        ${context}
      </work_snapshot>

      <output_instructions>
        Output ONLY {"suggestions":["<slug>","<slug>","<slug>"]} with exactly three strings.
        Each slug must follow output_format and rules above.
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
