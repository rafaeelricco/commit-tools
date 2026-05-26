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
      <work_snapshot>
        ${context}
      </work_snapshot>

      <role>
        You are a senior engineer reading the work snapshot above.
        Propose three distinct branch names for this work.
      </role>

      <output_shape>
        Return ONE JSON object, no markdown, no prose.
        First character "{", last character "}". Schema:
        {"suggestions":[
          {"name":"<slug>","rationale":"<one short clause>"},
          {"name":"<slug>","rationale":"<one short clause>"},
          {"name":"<slug>","rationale":"<one short clause>"}
        ]}
      </output_shape>

      <slug_rules>
        - Pattern: ^[a-z0-9]+(-[a-z0-9]+)*$  (lowercase, single hyphens, no slashes)
        - Length: roughly 15-50 characters, never over 60.
        - Grounded in tokens from file paths, symbols, or domain nouns in the snapshot.
        - Forbidden as the FIRST token: change-type labels (feat, fix, chore, docs,
          refactor, test, perf, build, ci, feature, bugfix, hotfix, release) AND vague
          verbs (add, update, change, improve, tweak, misc, wip, tmp).
        - ALLOWED as the LAST token: a change-kind word (refactor, cleanup, rewrite,
          hardening, migration, feature) when it sharpens the framing.
          Example: "frontend-list-ui-refactor" is valid because "refactor" is the suffix.
        - Forbidden anywhere: tooling/instruction words — suggestion(s), prompt,
          llm, model, cli, tool(s), command(s), workflow, meta, kebab-case, snapshot,
          context, branch-name, name-picker.
        - Never trunk names: main, master, develop, head.
        - Area prefix: if every changed file shares one top-level area visible in
          the paths (a monorepo package, a top-level src/<area> subtree, or a
          clearly named layer like "frontend"/"backend"/"api"/"web"), at least one
          slug SHOULD start with that area as its leading token (e.g. "frontend-...",
          "api-...", "web-..."). Do not invent areas that aren't in the file paths.
        - Preferred shape for the broader-theme suggestion: <area>-<theme>-<kind>
          where <kind> is a change-kind suffix from the allowed list (e.g.
          "frontend-list-ui-refactor", "api-auth-hardening"). Use this shape when
          the diff spans multiple files under one area; skip it for narrow diffs.
      </slug_rules>

      <rationale_rules>
        - One short clause, no more than 80 characters, lowercase start, no trailing period.
        - Explains WHY this framing — what facet of the change it emphasizes.
        - Do not repeat the slug verbatim. Do not just restate file names.
      </rationale_rules>

      <diversity_axes>
        The three suggestions MUST cover three different axes. Pick three from:
        - component/module focus (names the specific code being extracted or built)
        - broader feature/theme framing (names the overall shape of the work)
        - user-visible change framing (names what a product user would notice)
        - refactor/architecture framing (names the structural shift)
        - shared/reusable focus (names what becomes reusable across pages)
      </diversity_axes>

      <synthesis_protocol>
        Before answering, internally (you do NOT output these steps):
        1. List every file in the snapshot and the one-phrase intent of each hunk.
        2. Group the hunks into 1-3 themes that span multiple files.
        3. Pick the three diversity axes that best describe this diff.
        4. Draft a slug for each axis, then verify each slug:
           (a) matches the pattern, (b) is grounded in snapshot tokens,
           (c) is not just a subset of another slug,
           (d) frames a different axis than the other two.
        5. If two slugs frame the same axis, replace one before emitting.
      </synthesis_protocol>

      <examples>
        <example>
          <work_snapshot_summary>Diff refactors ops/campaigns + org/campaigns + ops/events + ops/products under app/frontend/ to use shared EmptyState, FilterPill, CampaignCard; adds pagination counts ("Showing X-Y of N") with restyled Pagination component.</work_snapshot_summary>
          <output>{"suggestions":[{"name":"frontend-list-ui-refactor","rationale":"broader framing of the cross-page list restructure"},{"name":"frontend-shared-list-components","rationale":"emphasizes the extracted EmptyState, FilterPill, and CampaignCard"},{"name":"frontend-pagination-with-counts","rationale":"leads with the most user-visible change"}]}</output>
        </example>
        <example>
          <work_snapshot_summary>Adds null-guard to src/parser/parser.ts and a regression test in src/parser/parser.test.ts.</work_snapshot_summary>
          <output>{"suggestions":[{"name":"parser-null-guard","rationale":"names the specific code path being hardened"},{"name":"parser-hardening","rationale":"broader framing across guard and regression test"},{"name":"crash-on-empty-input","rationale":"user-visible bug being prevented"}]}</output>
        </example>
        <example>
          <work_snapshot_summary>Adds /api/users/:id/sessions endpoint with handler in api/handlers/sessions.ts, DB query in api/db/sessions.ts, OpenAPI schema in api/openapi.yaml.</work_snapshot_summary>
          <output>{"suggestions":[{"name":"api-user-sessions-endpoint","rationale":"component focus on the new sessions handler"},{"name":"api-sessions-feature","rationale":"broader framing across handler, query, and schema"},{"name":"list-active-sessions","rationale":"user-visible capability the endpoint exposes"}]}</output>
        </example>
      </examples>

      <output_instructions>
        Emit ONLY the JSON object. No prose, no markdown fences, no commentary.
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
