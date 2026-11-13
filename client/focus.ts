import type { Row } from "../shared/board";

export const FOCUSES = ["all", "action", "fix", "rereview", "review"] as const;
export type Focus = (typeof FOCUSES)[number];

export const FOCUS_LABELS: Record<Focus, string> = {
  all: "All",
  action: "Needs my action",
  fix: "My PRs to fix",
  rereview: "Answered → re-review",
  review: "To review",
};

const isFailing = (row: Row) => row.ci === "FAILURE" || row.ci === "ERROR";

const MATCHERS: Record<Exclude<Focus, "all" | "action">, (row: Row) => boolean> = {
  fix: (row) => row.section === "mine" && (row.threadsToAnswer > 0 || row.changesRequested || isFailing(row)),
  rereview: (row) => row.section !== "mine" && (row.section === "toMe" || row.repliesWaiting > 0),
  review: (row) => row.section !== "mine" && row.reviewRequested,
};

export function matchesFocus(row: Row, focus: Focus): boolean {
  if (focus === "all") return true;
  if (focus === "action") return Object.values(MATCHERS).some((matches) => matches(row));
  return MATCHERS[focus](row);
}
