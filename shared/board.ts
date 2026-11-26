import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PROMPT_KINDS } from "./prompts";

export const REPO_OWNER = "rogerhrgeneva";
export const REPO_NAME = "roger-platform";

export const SECTIONS = ["mine", "notReviewed", "toMe", "withAuthor", "approved"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_TITLES: Record<Section, string> = {
  mine: "My PRs",
  notReviewed: "Not reviewed",
  toMe: "Back to me",
  withAuthor: "With the author",
  approved: "Approved",
};

export const AREAS = ["Frontend", "Backend", "Integrations", "Infra & CI", "AI config", "Other"] as const;
export type Area = (typeof AREAS)[number];

const sectionSchema = z.enum(SECTIONS);
const areaSchema = z.enum(AREAS);
const verdictSchema = z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]);

const rowSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  headOid: z.string(),
  forRelease: z.boolean(),
  ci: z.string().nullable(),
  areas: z.array(areaSchema),
  section: sectionSchema,
  summary: z.string(),
  summaryPending: z.boolean(),
  reviewers: z.array(z.object({ login: z.string(), verdict: verdictSchema })),
  reviewRequested: z.boolean(),
  reviewRequestedAt: z.string().nullable(),
  changesRequested: z.boolean(),
  myLastReviewAt: z.string().nullable(),
  pushedSinceMyReview: z.boolean(),
  newCommits: z.array(z.string()),
  rebasedOnly: z.boolean(),
  stale: z.boolean(),
  stackBlocked: z.boolean(),
  changesSinceUrl: z.string().nullable(),
  myOpenThreads: z.number(),
  myResolvedThreads: z.number(),
  repliesWaiting: z.number(),
  threadsToAnswer: z.number(),
  waitingForReview: z.boolean(),
  /** Comments in my unsubmitted (pending) review on this PR; null when I have none. */
  pendingReviewComments: z.number().nullable(),
  stack: z
    .object({ position: z.number(), size: z.number(), below: z.number().nullable(), root: z.number() })
    .nullable(),
});

export type Row = z.infer<typeof rowSchema>;
export type Verdict = z.infer<typeof verdictSchema>;

export const boardRpc = defineRpc({
  name: "board.fetch",
  input: z.object({}),
  output: z.object({
    login: z.string(),
    rows: z.array(rowSchema),
    summariesPending: z.boolean(),
    fetchedAt: z.string(),
  }),
});

export const boardStateSchema = z.object({
  ignored: z.record(z.string(), z.string()),
  collapsed: z.record(z.string(), z.boolean()),
  collapsedStacks: z.record(z.string(), z.boolean()),
  /** Personal reminders per PR number. */
  notes: z.record(z.string(), z.string()),
  showDrafts: z.boolean(),
  showIgnored: z.boolean(),
  showStale: z.boolean(),
  focus: z.enum(["all", "action", "fix", "rereview", "review"]),
  forReleaseOnly: z.boolean(),
  preReview: z.enum(["all", "done", "notDone"]),
  author: z.string().nullable(),
  areas: z.array(areaSchema),
  /** My edited chat prompts by kind; a missing or empty one falls back to its default. */
  prompts: z.partialRecord(z.enum(PROMPT_KINDS), z.string()),
});

export type BoardState = z.infer<typeof boardStateSchema>;

export const DEFAULT_BOARD_STATE: BoardState = {
  ignored: {},
  collapsed: { withAuthor: true, approved: true },
  collapsedStacks: {},
  notes: {},
  showDrafts: false,
  showIgnored: false,
  showStale: false,
  focus: "all",
  forReleaseOnly: false,
  preReview: "all",
  author: null,
  areas: [],
  prompts: {},
};

export const getStateRpc = defineRpc({
  name: "state.get",
  input: z.object({}),
  output: boardStateSchema,
});

export const setStateRpc = defineRpc({
  name: "state.set",
  input: boardStateSchema,
  output: z.object({}),
});

/** Review threads waiting on my answer across my open PRs; drives the sidebar count. */
export const commentsToAnswerRpc = defineRpc({
  name: "board.comments-to-answer",
  input: z.object({}),
  output: z.object({ count: z.number() }),
});
