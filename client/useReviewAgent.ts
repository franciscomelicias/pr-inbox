import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { REPO_NAME, REPO_OWNER, type BoardState, type Row } from "../shared/board";
import { fillPrompt } from "../shared/prompts";
import { preReviewDequeueRpc, preReviewEnqueueRpc, preReviewQueueRpc, type PreReviewQueue } from "../shared/pre-review";

const REPO_PATH = "/Users/franciscomelicias/Documents/roger-platform";
export const PROVIDER = "claude/claude-opus-5-5";
// Explaining a PR needs speed more than depth.
const ASK_PROVIDER = "claude/claude-sonnet-5-5";
const PRE_REVIEW_TITLE = /^Pre-review PR #(\d+)$/;
// Local daemon calls, not GitHub: cheap enough to poll. useAgent only works inside workspace panels.
const AGENTS_POLL_MS = 5 * 1000;

export interface PreReviewAgent {
  id: string;
  status: string;
  attentionReason: string | null;
}

/** Opens (or reuses) a Paseo worktree on the PR's branch with an agent briefed for the review. */
export function useReviewAgent(navigation: PluginSurfaceProps["navigation"], prompts: BoardState["prompts"]) {
  const paseo = usePaseo();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** PR number → the latest pre-review agent, found by title so runs survive reopening the board. */
  const [preReviews, setPreReviews] = useState<Record<number, PreReviewAgent>>({});
  const [queue, setQueue] = useState<PreReviewQueue>({ running: null, waiting: [] });
  const getQueue = useRpc(preReviewQueueRpc);
  const enqueue = useRpc(preReviewEnqueueRpc);
  const dequeue = useRpc(preReviewDequeueRpc);

  const loadPreReviews = async () => {
    const { entries } = await paseo.agents.list();
    const found: Record<number, PreReviewAgent> = {};
    const agents = entries.map((entry) => entry.agent).filter((agent) => !agent.archivedAt);
    for (const agent of agents.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const match = agent.title?.match(PRE_REVIEW_TITLE);
      if (match) found[Number(match[1])] = { id: agent.id, status: agent.status, attentionReason: agent.attentionReason ?? null };
    }
    setPreReviews(found);
    setQueue(await getQueue({}));
  };

  useEffect(() => {
    void loadPreReviews();
    const timer = setInterval(() => void loadPreReviews(), AGENTS_POLL_MS);
    return () => clearInterval(timer);
  }, [paseo]);

  const start = async (row: Row) => {
    if (!navigation) return;
    setPending(row.number);
    setError(null);
    try {
      const title = workspaceTitle(row);
      const { entries } = await paseo.workspaces.list();
      const existing = entries.find((workspace) => workspace.title === title && !workspace.archivingAt);
      if (existing) {
        navigation.openWorkspace({ workspaceId: existing.id });
        return;
      }
      const workspace = await paseo.workspaces.create({
        title,
        source: {
          kind: "worktree",
          cwd: REPO_PATH,
          action: "checkout",
          checkoutSource: { kind: "change_request", forge: "github", number: row.number },
        },
      });
      const agent = await workspace.agents.create({
        config: { provider: PROVIDER },
        title,
        prompt: fillPrompt(prompts, row.section === "mine" ? "fix" : "review", promptValues(row)),
      });
      navigation.openAgent({ agentId: agent.id });
    } catch (cause) {
      setError(`#${row.number}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPending(null);
    }
  };

  /** A read-only chat about the PR in the main checkout: no worktree, so it opens in seconds. */
  const ask = async (row: Row) => {
    if (!navigation) return;
    setPending(row.number);
    setError(null);
    try {
      const title = `Ask PR #${row.number}`;
      const { entries } = await paseo.agents.list();
      const existing = entries.map((entry) => entry.agent).find((agent) => agent.title === title && !agent.archivedAt);
      if (existing) {
        navigation.openAgent({ agentId: existing.id });
        return;
      }
      const agent = await paseo.agents.create({
        config: { provider: ASK_PROVIDER },
        cwd: REPO_PATH,
        title,
        prompt: fillPrompt(prompts, "ask", promptValues(row)),
      });
      navigation.openAgent({ agentId: agent.id });
    } catch (cause) {
      setError(`#${row.number}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPending(null);
    }
  };

  /** Queues /review-like-francisco runs in the daemon, one after the other; the board only shows progress. */
  const preReview = async (numbers: number[]) => {
    setError(null);
    try {
      setQueue(await enqueue({ numbers }));
      await loadPreReviews();
    } catch (cause) {
      setError(`Pre-review: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const unqueue = async (number: number) => setQueue(await dequeue({ number }));

  const openAgent = (agentId: string) => navigation?.openAgent({ agentId });

  return {
    start,
    ask,
    preReview,
    unqueue,
    preReviews,
    queue,
    openAgent,
    pending,
    error,
    available: navigation !== undefined,
  };
}

function workspaceTitle(row: Row): string {
  return row.section === "mine" ? `Fix PR #${row.number}` : `Review PR #${row.number}`;
}

function promptValues(row: Row): Record<string, string | number> {
  const newCommits =
    row.newCommits.length > 0
      ? `
I already reviewed this PR. Focus on what changed since my last review — these commits are new
(the branch may have been rebased, so compare by commit, not by sha):
${row.newCommits.map((subject) => `- ${subject}`).join("\n")}
Also check whether my earlier threads were actually addressed.`
      : "";
  return { number: row.number, title: row.title, author: row.author, repo: `${REPO_OWNER}/${REPO_NAME}`, newCommits };
}

export function reviewPlanPrompt(pr: { number: number; title: string }): string {
  return `Help me address the review feedback on my PR #${pr.number} "${pr.title}".
If this worktree is not on the PR's head branch (it may hold a whole stack), check that branch out first.

Run the /review-plan skill to go through the unresolved comments and failing checks, then present the plan.
Do not change code, push, or reply on GitHub until I approve the plan.`;
}

/** One plan for several PRs of the stack this worktree holds, bottom first. */
export function stackReviewPlanPrompt(prs: { number: number; title: string }[]): string {
  return `Help me address the review feedback on these PRs of the stack this worktree holds, bottom first:
${prs.map((pr) => `- #${pr.number} "${pr.title}"`).join("\n")}

For each PR, check out its head branch and run the /review-plan skill to go through its unresolved comments and
failing checks. Then present one plan, grouped by PR.
Do not change code, push, or reply on GitHub until I approve the plan. A fix on a lower PR means rebasing the
layers above it (\`gh stack rebase\`) before pushing.`;
}

export function rebasePrompt(pr: { number: number; title: string; baseRefName: string }): string {
  return `My PR #${pr.number} "${pr.title}" has merge conflicts with \`${pr.baseRefName}\`. Rebase it.
If this worktree is not on the PR's head branch, check that branch out first; if it is part of a gh-stack, use the /gh-stack skill to rebase the stack instead.

1. \`git fetch origin\`, then rebase onto \`origin/${pr.baseRefName}\`.
2. Resolve each conflict keeping both sides' intent; stop and ask me when the right resolution is unclear.
3. Run the checks for the files you touched.
4. Show me what you resolved, and push with \`--force-with-lease\` only after I say go.`;
}
