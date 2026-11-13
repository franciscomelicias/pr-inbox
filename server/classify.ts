import type { Area, Row, Section, Verdict } from "../shared/board";
import type { PullRequestDetails } from "./github";

type ClassifiedRow = Omit<Row, "summary" | "summaryPending">;

const VERDICT_STATES = new Set(["APPROVED", "CHANGES_REQUESTED"]);
const BOT_LOGINS = /(\[bot\]|-bot)$|^(copilot-pull-request-reviewer|coderabbitai|github-advanced-security)$/;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** The commit my last effective review was made on; null when I never reviewed or wrote the PR. */
export function myReviewOid(pr: PullRequestDetails, login: string): string | null {
  if (pr.author?.login === login) return null;
  return effectiveReviews(pr).filter((review) => review.author?.login === login).at(-1)?.commit?.oid ?? null;
}

export function classify(input: {
  pr: PullRequestDetails;
  login: string;
  topLevelPaths: string[];
  /** Commits added since my review, rebases excluded; null when there is nothing to compare. */
  newCommits: string[] | null;
}): ClassifiedRow {
  const { pr, login, topLevelPaths, newCommits } = input;
  const author = pr.author?.login ?? "ghost";
  const reviews = effectiveReviews(pr);
  const myReviews = reviews.filter((review) => review.author?.login === login);
  const myLastReview = myReviews.at(-1) ?? null;
  const myLastReviewAt = myLastReview?.submittedAt ?? null;
  // An approval stands even when COMMENTED reviews follow it.
  const myVerdict = myReviews.filter((review) => VERDICT_STATES.has(review.state)).at(-1) ?? null;

  const reviewers = latestVerdicts(
    reviews.filter((review) => review.author?.login !== author && !BOT_LOGINS.test(review.author?.login ?? "")),
  );
  // My pending review's comments already come back as threads; nobody else sees them until I submit.
  const threads = pr.reviewThreads.nodes.filter((thread) => thread.comments.nodes[0]?.state !== "PENDING");
  const myThreads = threads.filter((thread) => thread.comments.nodes[0]?.author?.login === login);
  const threadsIParticipateIn = threads.filter((thread) =>
    thread.comments.nodes.some((comment) => comment.author?.login === login),
  );
  const repliesWaiting = threadsIParticipateIn.filter(
    (thread) => !thread.isResolved && thread.comments.nodes.at(-1)?.author?.login !== login,
  ).length;
  const authorRepliedSinceMyReview =
    myLastReviewAt !== null &&
    threadsIParticipateIn.some((thread) =>
      thread.comments.nodes.some(
        (comment) => comment.author?.login === author && comment.createdAt > myLastReviewAt,
      ),
    );

  const reviewOid = myLastReview?.commit?.oid ?? null;
  const isMine = author === login;
  const headMoved = !isMine && reviewOid !== null && reviewOid !== pr.headRefOid;
  const pushedSinceMyReview = headMoved && (newCommits === null || newCommits.length > 0);
  const reviewRequestedAt = reviewRequestedSince({ pr, login, since: myLastReviewAt });
  const reviewRequested = reviewRequestedAt !== null;

  const verdicts = reviewers.map((reviewer) => reviewer.verdict);
  const changesRequested = pr.reviewDecision === "CHANGES_REQUESTED" || verdicts.includes("CHANGES_REQUESTED");

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author,
    isDraft: pr.isDraft,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    headOid: pr.headRefOid,
    forRelease: pr.labels.nodes.some((label) => label.name === "for-release"),
    ci: pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    areas: toAreas(topLevelPaths),
    section: toSection({
      isMine,
      hasReviewed: myLastReview !== null,
      approved: myVerdict?.state === "APPROVED",
      moved: pushedSinceMyReview || authorRepliedSinceMyReview || reviewRequested,
      reviewRequested,
    }),
    reviewers,
    reviewRequested,
    reviewRequestedAt,
    changesRequested,
    myLastReviewAt,
    pushedSinceMyReview,
    newCommits: pushedSinceMyReview ? (newCommits ?? []) : [],
    rebasedOnly: headMoved && !pushedSinceMyReview,
    // updatedAt moves with every bot comment and CI run, so the last commit tells how long the PR sat untouched.
    stale: Date.now() - new Date(pr.commits.nodes[0]?.commit.committedDate ?? pr.updatedAt).getTime() > STALE_AFTER_MS,
    stackBlocked: false,
    pendingReviewComments:
      pr.reviews.nodes.find((review) => review.state === "PENDING" && review.author?.login === login)?.comments.totalCount ??
      null,
    changesSinceUrl: pushedSinceMyReview ? `${pr.url}/files/${reviewOid}..${pr.headRefOid}` : null,
    myOpenThreads: myThreads.filter((thread) => !thread.isResolved).length,
    myResolvedThreads: myThreads.filter((thread) => thread.isResolved).length,
    repliesWaiting,
    threadsToAnswer: threads.filter(
      (thread) => !thread.isResolved && thread.comments.nodes.at(-1)?.author?.login !== login,
    ).length,
    waitingForReview: !verdicts.some((verdict) => verdict !== "COMMENTED"),
    stack: null,
  };
}

/** Stacked PRs: a PR whose base branch is another open PR's head branch sits on top of it. */
export function assignStacks(rows: ClassifiedRow[], refs: Map<number, { head: string; base: string }>): void {
  const byHead = new Map<string, number>();
  refs.forEach((ref, number) => byHead.set(ref.head, number));
  const below = (number: number) => {
    const base = refs.get(number)?.base;
    return base === undefined ? undefined : byHead.get(base);
  };
  const above = new Map<number, number[]>();
  refs.forEach((_, number) => {
    const parent = below(number);
    if (parent !== undefined) above.set(parent, [...(above.get(parent) ?? []), number]);
  });
  const height = (number: number): number =>
    1 + Math.max(0, ...(above.get(number) ?? []).map((child) => height(child)));

  for (const row of rows) {
    let root = row.number;
    let position = 1;
    for (let parent = below(root); parent !== undefined; parent = below(root)) {
      root = parent;
      position += 1;
    }
    const size = height(root);
    if (size > 1) row.stack = { position, size, below: below(row.number) ?? null, root };
  }
  const failingRoots = new Set(
    rows.filter((row) => row.stack?.position === 1 && (row.ci === "FAILURE" || row.ci === "ERROR")).map((row) => row.number),
  );
  rows.forEach((row) => {
    row.stackBlocked = row.stack !== null && failingRoots.has(row.stack.root);
  });
}

/** Priority inside a section, then stack members pulled together next to their best-ranked member, bottom first. */
export function sortRows<T extends ClassifiedRow>(rows: T[]): T[] {
  const ranked = [...rows].sort(compareRows);
  const result: T[] = [];
  const placed = new Set<number>();
  for (const row of ranked) {
    if (placed.has(row.number)) continue;
    const group = row.stack
      ? ranked
          .filter((candidate) => candidate.stack?.root === row.stack?.root && candidate.section === row.section)
          .sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0))
      : [row];
    group.forEach((member) => placed.add(member.number));
    result.push(...group);
  }
  return result;
}

function compareRows(a: ClassifiedRow, b: ClassifiedRow): number {
  const keys = (row: ClassifiedRow) => [
    row.section === "mine" && row.stackBlocked ? 0 : 1,
    row.isDraft ? 1 : 0,
    row.forRelease ? 0 : 1,
    row.repliesWaiting > 0 ? 0 : 1,
    row.pushedSinceMyReview || row.changesRequested ? 0 : 1,
    row.reviewRequested ? 0 : 1,
  ];
  const [keysA, keysB] = [keys(a), keys(b)];
  const difference = keysA.findIndex((key, index) => key !== keysB[index]);
  if (difference !== -1) return keysA[difference] - keysB[difference];
  return a.createdAt.localeCompare(b.createdAt);
}

function toSection(input: {
  isMine: boolean;
  hasReviewed: boolean;
  approved: boolean;
  moved: boolean;
  reviewRequested: boolean;
}): Section {
  if (input.isMine) return "mine";
  if (!input.hasReviewed) return "notReviewed";
  if (input.approved) return input.reviewRequested ? "toMe" : "approved";
  return input.moved ? "toMe" : "withAuthor";
}

// A dismissed review counts as never given, and a pending one is not submitted yet.
function effectiveReviews(pr: PullRequestDetails) {
  return pr.reviews.nodes.filter(
    (review) => review.submittedAt !== null && review.state !== "DISMISSED" && review.state !== "PENDING",
  );
}

/** reviewRequests keeps listing a reviewer after they approve, so only the timeline tells a fresh request apart. */
function reviewRequestedSince(input: { pr: PullRequestDetails; login: string; since: string | null }): string | null {
  const lastEvent = input.pr.timelineItems.nodes
    .filter((event) => event.requestedReviewer && "login" in event.requestedReviewer)
    .filter((event) => (event.requestedReviewer as { login: string }).login === input.login)
    .at(-1);
  if (lastEvent?.__typename !== "ReviewRequestedEvent") return null;
  return input.since === null || lastEvent.createdAt > input.since ? lastEvent.createdAt : null;
}

function latestVerdicts(reviews: PullRequestDetails["reviews"]["nodes"]): { login: string; verdict: Verdict }[] {
  const byLogin = new Map<string, Verdict>();
  for (const review of reviews) {
    const login = review.author?.login;
    if (!login) continue;
    if (VERDICT_STATES.has(review.state)) byLogin.set(login, review.state as Verdict);
    else if (!byLogin.has(login)) byLogin.set(login, "COMMENTED");
  }
  return [...byLogin].map(([login, verdict]) => ({ login, verdict }));
}

function toAreas(topLevelPaths: string[]): Area[] {
  const areas = new Set<Area>(topLevelPaths.map(toArea));
  return [...areas];
}

function toArea(topLevel: string): Area {
  if (topLevel === "roger-frontend" || topLevel === "roger-backoffice-frontend") return "Frontend";
  if (topLevel.startsWith("roger-integration-") || topLevel === "roger-common-integration") return "Integrations";
  if (topLevel.startsWith("roger-") || /^(gradle|postgres|floci)$|gradle|lockfile|^lombok/.test(topLevel)) {
    return "Backend";
  }
  if (/^(\.github|infrastructure|config|docker-compose\.yml|lefthook\.yml)$/.test(topLevel)) return "Infra & CI";
  if (/^(\.claude|\.gitar|ai|AGENTS\.md|CLAUDE\.md)$/.test(topLevel)) return "AI config";
  return "Other";
}
