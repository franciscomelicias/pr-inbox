import type { Row } from "../shared/board";

/** What still stands between a PR and the next step: merge for my PRs, my review for the others. */
export function missingItems(row: Row): string[] {
  const items: string[] = [];
  const blockers = row.reviewers.filter((reviewer) => reviewer.verdict === "CHANGES_REQUESTED").map((r) => r.login);
  if (row.isDraft) items.push("draft");
  if (row.ci === "FAILURE" || row.ci === "ERROR") items.push("CI failing");
  if (blockers.length > 0) items.push(`changes requested by ${blockers.join(", ")}`);
  if (row.section === "mine") {
    if (row.threadsToAnswer > 0) items.push(`${row.threadsToAnswer} threads to answer`);
    if (row.waitingForReview) items.push("waiting for review");
    return items;
  }
  if (row.section === "notReviewed") items.push("not reviewed by me");
  if (row.reviewRequested) items.push("review requested");
  if (row.repliesWaiting > 0) items.push(`${row.repliesWaiting} replies waiting`);
  if (row.pushedSinceMyReview) items.push(`${row.newCommits.length || "new"} commits since my review`);
  return items;
}

export function readyLabel(row: Row): string {
  const approvals = row.reviewers.filter((reviewer) => reviewer.verdict === "APPROVED").length;
  return row.section === "mine" ? `ready · ✓ ${approvals}` : "nothing for me";
}
