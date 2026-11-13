import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { REPO_NAME, REPO_OWNER } from "../shared/board";
import { readJson, writeJson } from "./cache";

const execFileAsync = promisify(execFile);

// The daemon is launched by the desktop app, so its PATH usually lacks Homebrew.
const GH = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].find(existsSync) ?? "gh";
const DETAIL_BATCH_SIZE = 3;
const FILES_CONCURRENCY = 6;
const AREAS_CACHE = "areas.json";

export interface ListedPullRequest {
  number: number;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  author: string;
}

export interface Actor {
  login: string;
}

export interface PullRequestDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  reviewDecision: string | null;
  author: Actor | null;
  labels: { nodes: { name: string }[] };
  commits: { nodes: { commit: { committedDate: string; statusCheckRollup: { state: string } | null } }[] };
  reviews: {
    nodes: {
      author: Actor | null;
      state: string;
      submittedAt: string | null;
      commit: { oid: string } | null;
      comments: { totalCount: number };
    }[];
  };
  reviewThreads: {
    nodes: { isResolved: boolean; comments: { nodes: { author: Actor | null; createdAt: string; state: string }[] } }[];
  };
  timelineItems: {
    nodes: { __typename: string; createdAt: string; requestedReviewer: Actor | Record<string, never> | null }[];
  };
}

const DETAILS_FRAGMENT = `
fragment Details on PullRequest {
  number title body url isDraft createdAt updatedAt additions deletions changedFiles
  baseRefName headRefName headRefOid reviewDecision
  author { login }
  labels(first: 20) { nodes { name } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
  reviews(last: 100) { nodes { author { login } state submittedAt commit { oid } comments { totalCount } } }
  reviewThreads(first: 100) {
    nodes { isResolved comments(first: 50) { nodes { author { login } createdAt state } } }
  }
  timelineItems(last: 100, itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT]) {
    nodes {
      __typename
      ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } }
      ... on ReviewRequestRemovedEvent { createdAt requestedReviewer { ... on User { login } } }
    }
  }
}`;

let cachedLogin: string | undefined;

export async function resolveLogin(): Promise<string> {
  if (process.env.REVIEW_BOARD_LOGIN) return process.env.REVIEW_BOARD_LOGIN;
  if (!cachedLogin) {
    const { stdout } = await gh(["api", "user", "--jq", ".login"]);
    cachedLogin = stdout.trim();
  }
  return cachedLogin;
}

export async function listOpenPullRequests(): Promise<ListedPullRequest[]> {
  const listed: ListedPullRequest[] = [];
  let after: string | null = null;
  do {
    const data: {
      search: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { number: number; headRefName: string; baseRefName: string; headRefOid: string; author: Actor | null }[];
      };
    } = await graphql(
      `query($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ... on PullRequest { number headRefName baseRefName headRefOid author { login } } }
        }
      }`,
      { q: `repo:${REPO_OWNER}/${REPO_NAME} is:pr is:open`, after },
    );
    listed.push(...data.search.nodes.map((node) => ({ ...node, author: node.author?.login ?? "ghost" })));
    after = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null;
  } while (after);
  return listed;
}

export async function fetchDetails(numbers: number[]): Promise<PullRequestDetails[]> {
  const batches = chunk(numbers, DETAIL_BATCH_SIZE);
  const results = await Promise.all(
    batches.map(async (batch) => {
      const fields = batch.map((number) => `pr${number}: pullRequest(number: ${number}) { ...Details }`).join("\n");
      const data: { repository: Record<string, PullRequestDetails | null> } = await graphql(
        `query { repository(owner: "${REPO_OWNER}", name: "${REPO_NAME}") { ${fields} } } ${DETAILS_FRAGMENT}`,
        {},
      );
      return Object.values(data.repository).filter((pr): pr is PullRequestDetails => pr !== null);
    }),
  );
  return results.flat();
}

/** Top-level paths a PR touches, cached by head commit + base branch since stale branches can list thousands of files. */
export async function fetchTouchedPaths(pullRequests: ListedPullRequest[]): Promise<Map<number, string[]>> {
  const cache = await readJson<Record<string, string[]>>(AREAS_CACHE, {});
  const result = new Map<number, string[]>();
  const missing = pullRequests.filter((pr) => {
    const cached = cache[cacheKey(pr)];
    if (cached) result.set(pr.number, cached);
    return !cached;
  });
  for (const batch of chunk(missing, FILES_CONCURRENCY)) {
    await Promise.all(
      batch.map(async (pr) => {
        const paths = await fetchAllFilePaths(pr.number);
        cache[cacheKey(pr)] = paths;
        result.set(pr.number, paths);
      }),
    );
  }
  if (missing.length > 0) {
    const liveKeys = new Set(pullRequests.map(cacheKey));
    await writeJson(AREAS_CACHE, Object.fromEntries(Object.entries(cache).filter(([key]) => liveKeys.has(key))));
  }
  return result;
}

async function fetchAllFilePaths(number: number): Promise<string[]> {
  const topLevel = new Set<string>();
  let after: string | null = null;
  do {
    const data: {
      repository: {
        pullRequest: {
          files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { path: string }[] };
        };
      };
    } = await graphql(
      `query($number: Int!, $after: String) {
        repository(owner: "${REPO_OWNER}", name: "${REPO_NAME}") {
          pullRequest(number: $number) {
            files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path } }
          }
        }
      }`,
      { number, after },
    );
    const files = data.repository.pullRequest.files;
    files.nodes.forEach((file) => topLevel.add(file.path.split("/")[0]));
    after = files.pageInfo.hasNextPage ? files.pageInfo.endCursor : null;
  } while (after);
  return [...topLevel];
}

export interface BranchPullRequest {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
}

/** The most recent PR opened from each branch, whatever its state. */
export async function fetchPullRequestsByBranch(branches: string[]): Promise<Map<string, BranchPullRequest>> {
  const result = new Map<string, BranchPullRequest>();
  for (const batch of chunk(branches, 20)) {
    const fields = batch
      .map(
        (branch, index) =>
          `b${index}: pullRequests(headRefName: ${JSON.stringify(branch)}, first: 1, states: [OPEN, MERGED, CLOSED], orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number url title state } }`,
      )
      .join("\n");
    const data: { repository: Record<string, { nodes: BranchPullRequest[] }> } = await graphql(
      `query { repository(owner: "${REPO_OWNER}", name: "${REPO_NAME}") { ${fields} } }`,
      {},
    );
    batch.forEach((branch, index) => {
      const pr = data.repository[`b${index}`]?.nodes[0];
      if (pr) result.set(branch, pr);
    });
  }
  return result;
}

const NEW_COMMITS_CACHE = "new-commits.json";
const REVIEW_HISTORY_PAGES = 3;

/**
 * Subjects of the PR's non-merge commits that were not in the history of the reviewed commit.
 * A rebase rewrites every sha (and, in a stack, the base too), so commit subjects are the only
 * stable identity; an empty list means the push since the review was only a rebase.
 */
export async function fetchNewCommits(
  targets: { number: number; reviewOid: string; headOid: string }[],
): Promise<Map<number, string[] | null>> {
  const cache = await readJson<Record<string, string[]>>(NEW_COMMITS_CACHE, {});
  const result = new Map<number, string[] | null>();
  const key = (target: (typeof targets)[number]) => `${target.number}:${target.reviewOid}:${target.headOid}`;
  const missing = targets.filter((target) => {
    const cached = cache[key(target)];
    if (cached) result.set(target.number, cached);
    return !cached;
  });
  for (const batch of chunk(missing, FILES_CONCURRENCY)) {
    await Promise.all(
      batch.map(async (target) => {
        try {
          const [reviewed, current] = await Promise.all([
            reviewHistorySubjects(target.reviewOid),
            restLines(`repos/${REPO_OWNER}/${REPO_NAME}/pulls/${target.number}/commits?per_page=100`, {
              jq: '.[] | select(.parents | length == 1) | .commit.message | split("\n")[0]',
              paginate: true,
            }),
          ]);
          const added = [...new Set(current.filter((subject) => !reviewed.has(subject)))];
          cache[key(target)] = added;
          result.set(target.number, added);
        } catch (error) {
          console.error(`[pr-inbox] new commits of #${target.number} failed`, error);
          result.set(target.number, null);
        }
      }),
    );
  }
  if (missing.length > 0) {
    const liveKeys = new Set(targets.map(key));
    await writeJson(NEW_COMMITS_CACHE, Object.fromEntries(Object.entries(cache).filter(([k]) => liveKeys.has(k))));
  }
  return result;
}

async function reviewHistorySubjects(oid: string): Promise<Set<string>> {
  const subjects = new Set<string>();
  for (let page = 1; page <= REVIEW_HISTORY_PAGES; page++) {
    const lines = await restLines(`repos/${REPO_OWNER}/${REPO_NAME}/commits?sha=${oid}&per_page=100&page=${page}`, {
      jq: '.[].commit.message | split("\n")[0]',
      paginate: false,
    });
    lines.forEach((line) => subjects.add(line));
    if (lines.length < 100) break;
  }
  return subjects;
}

async function restLines(path: string, options: { jq: string; paginate: boolean }): Promise<string[]> {
  const { stdout } = await gh(["api", path, "--jq", options.jq, ...(options.paginate ? ["--paginate"] : [])]);
  return stdout.split("\n").filter((line) => line.length > 0);
}

function cacheKey(pr: ListedPullRequest): string {
  return `${pr.number}:${pr.headRefOid}:${pr.baseRefName}`;
}

async function graphql<T>(query: string, variables: Record<string, string | number | null>): Promise<T> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value === null) continue;
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  const { stdout } = await gh(args);
  const parsed = JSON.parse(stdout);
  if (parsed.errors?.length) throw new Error(parsed.errors.map((error: { message: string }) => error.message).join("; "));
  return parsed.data;
}

async function gh(args: string[], attempt = 0): Promise<{ stdout: string }> {
  try {
    return await execFileAsync(GH, args, { maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt < 2 && /HTTP 50[234]|timed out|ECONNRESET|TLS handshake/.test(message)) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      return gh(args, attempt + 1);
    }
    throw error;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
