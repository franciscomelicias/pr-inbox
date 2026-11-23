export const PROMPT_KINDS = ["review", "fix", "ask", "preReview"] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];

export const PROMPT_LABELS: Record<PromptKind, string> = {
  review: "Review (someone else's PR)",
  fix: "Fix (my PR)",
  ask: "Ask",
  preReview: "Pre-review",
};

export const PROMPT_PLACEHOLDERS = "{{number}} {{title}} {{author}} {{repo}} {{newCommits}}";

export const DEFAULT_PROMPTS: Record<PromptKind, string> = {
  review: `Help me review PR #{{number}} "{{title}}" by @{{author}} in {{repo}}.
This worktree has the PR branch checked out.

First read the repo rules: AGENTS.md, roger-frontend/AGENTS.md for frontend files,
roger-frontend/docs/review.md and .claude/review/backend-review.md.
Then read the PR with \`gh pr view {{number}}\`, \`gh pr diff {{number}}\`, and the existing
review threads (\`gh api repos/{{repo}}/pulls/{{number}}/comments\`).
{{newCommits}}
Give me, briefly:
1. What the PR does, in 3 bullets.
2. The riskiest parts to read closely, as file:line.
3. Concrete problems you found, correctness first, each with file:line and why it matters.
4. Existing review comments that are still not addressed.

Do not edit files, push, or post anything on GitHub. After the summary, wait for my questions.`,
  fix: `Help me address the review feedback on my PR #{{number}} "{{title}}".
This worktree has the PR branch checked out. Run yarn install in roger-frontend/ before any frontend command.

Run the /review-plan skill to go through the unresolved comments and failing checks, then present the plan.
Do not change code, push, or reply on GitHub until I approve the plan.`,
  ask: `I want to understand PR #{{number}} "{{title}}" by @{{author}} in {{repo}} before reviewing it.

Read it without checking anything out: \`gh pr view {{number}} --repo {{repo}} --comments\` and \`gh pr diff {{number}} --repo {{repo}}\`.
If the title, branch or description names a Linear ticket (ROG-XXXX) and you can reach Linear, read the ticket for the "why".
Open files in this checkout only when you need surrounding code to explain something.

Then answer briefly, in this order:
1. Goal: the problem or need this PR addresses, and where that comes from (ticket, description).
2. What changes: grouped by area (backend, frontend, …), the key files only.
3. How it works: the main flow in a few steps.
4. Worth a closer look: risky or surprising parts, as file:line.

This is a read-only conversation: do not check out branches, edit files, push, or post on GitHub.
After the summary, wait for my questions about the PR.`,
  preReview: `Run the /review-like-francisco skill on PR #{{number}}.
I am not watching this chat: go through to the pending review without waiting for me, and never submit it.`,
};

/** The saved prompt of that kind, or its default, with every {{placeholder}} filled (unknown ones become empty). */
export function fillPrompt(
  overrides: Partial<Record<PromptKind, string>>,
  kind: PromptKind,
  values: Record<string, string | number>,
): string {
  return (overrides[kind] || DEFAULT_PROMPTS[kind]).replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
}
