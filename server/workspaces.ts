import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { Row } from "../shared/board";
import type { Category } from "../shared/workspaces";
import { getRecentBoard } from "./board";
import { fetchPullRequestsByBranch } from "./github";

const execFileAsync = promisify(execFile);
const GIT = ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"].find(existsSync) ?? "git";
// A board build costs ~45 GraphQL points; reuse it rather than rebuild on every Workspaces refresh.
const BOARD_MAX_AGE_MS = 15 * 60 * 1000;
// Release PRs are opened from these, so they would otherwise match the main checkout.
const DEFAULT_BRANCHES = new Set(["develop", "master", "main"]);

interface WorkspaceInput {
  id: string;
  branch: string | null;
  directory: string;
}

export async function classifyWorkspaces({ workspaces }: { workspaces: WorkspaceInput[] }) {
  const withBranches = await Promise.all(
    workspaces.map(async (workspace) => ({ ...workspace, branch: workspace.branch ?? (await currentBranch(workspace.directory)) })),
  );
  const branches = [...new Set(withBranches.flatMap((workspace) => (workspace.branch ? [workspace.branch] : [])))].filter(
    (branch) => !DEFAULT_BRANCHES.has(branch),
  );
  const [pullRequests, board] = await Promise.all([fetchPullRequestsByBranch(branches), getRecentBoard(BOARD_MAX_AGE_MS)]);
  const rowsByNumber = new Map(board.rows.map((row) => [row.number, row]));

  return {
    workspaces: withBranches.map((workspace) => {
      const pr = workspace.branch ? (pullRequests.get(workspace.branch) ?? null) : null;
      const row = pr ? rowsByNumber.get(pr.number) : undefined;
      const layers = !row ? [] : row.stack ? stackOf(row.stack.root, board.rows, row.number) : [layerOf(row, null, true)];
      const { category, reasons } = categorize({ pr, row, layers });
      return {
        id: workspace.id,
        branch: workspace.branch,
        category,
        pullRequest: pr,
        reasons,
        stack: row?.stack ? { position: row.stack.position, size: row.stack.size } : null,
        layers,
      };
    }),
    fetchedAt: new Date().toISOString(),
  };
}

type Layer = ReturnType<typeof layerOf>;

function categorize(input: {
  pr: { number: number; state: string } | null;
  row: Row | undefined;
  layers: Layer[];
}): { category: Category; reasons: string[] } {
  const { pr, row, layers } = input;
  if (!pr) return { category: "inProgress", reasons: ["no PR yet"] };
  if (pr.state !== "OPEN") return { category: "merged", reasons: [pr.state === "MERGED" ? "merged" : "closed without merging"] };
  if (!row) return { category: "finished", reasons: ["PR open"] };
  if (row.section !== "mine") return { category: "reviewing", reasons: [`@${row.author}'s PR`] };

  // A stacked PR waits on its whole stack, so feedback anywhere in it counts; each layer line says where.
  const waiting = layers.filter((layer) => layer.threadsToAnswer > 0 || layer.feedback.length > 0);
  if (waiting.length > 0) return { category: "withComments", reasons: [`feedback on ${waiting.map((layer) => `#${layer.number}`).join(", ")}`] };
  return { category: "finished", reasons: [row.isDraft ? "draft PR open" : "PR open, nothing to fix"] };
}

function stackOf(root: number, rows: Row[], current: number): Layer[] {
  return rows
    .flatMap((row) => (row.stack?.root === root ? [layerOf(row, row.stack.position, row.number === current)] : []))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function layerOf(row: Row, position: number | null, isCurrent: boolean) {
  const isMine = row.section === "mine";
  return {
    number: row.number,
    url: row.url,
    title: row.title,
    position,
    isCurrent,
    isMine,
    approvedBy: row.reviewers.filter((reviewer) => reviewer.verdict === "APPROVED").map((reviewer) => reviewer.login),
    // Threads to answer and a failing CI only call for my action on my own PRs.
    threadsToAnswer: isMine ? row.threadsToAnswer : 0,
    feedback: isMine ? feedback(row) : [],
  };
}

function feedback(row: Row): string[] {
  const reasons: string[] = [];
  const blockers = row.reviewers.filter((reviewer) => reviewer.verdict === "CHANGES_REQUESTED").map((r) => r.login);
  if (blockers.length > 0) reasons.push(`changes requested by ${blockers.join(", ")}`);
  if (row.ci === "FAILURE" || row.ci === "ERROR") reasons.push("CI failing");
  return reasons;
}

async function currentBranch(directory: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(GIT, ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: directory, timeout: 10_000 });
    const branch = stdout.trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}
