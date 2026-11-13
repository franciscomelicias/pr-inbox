import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const CATEGORIES = ["inProgress", "withComments", "finished", "reviewing", "merged"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_TITLES: Record<Category, string> = {
  inProgress: "In progress",
  withComments: "With comments",
  finished: "Finished",
  reviewing: "Reviewing others' PRs",
  merged: "Merged / closed",
};

export const classifyWorkspacesRpc = defineRpc({
  name: "workspaces.classify",
  input: z.object({
    workspaces: z.array(z.object({ id: z.string(), branch: z.string().nullable(), directory: z.string() })),
  }),
  output: z.object({
    workspaces: z.array(
      z.object({
        id: z.string(),
        branch: z.string().nullable(),
        category: z.enum(CATEGORIES),
        pullRequest: z.object({ number: z.number(), url: z.string(), title: z.string(), state: z.string() }).nullable(),
        reasons: z.array(z.string()),
        /** Position in the stack this workspace's PR sits in; null when not stacked. */
        stack: z.object({ position: z.number(), size: z.number() }).nullable(),
        /** Every open PR of the stack (bottom first), or the workspace's own PR alone. */
        layers: z.array(
          z.object({
            number: z.number(),
            url: z.string(),
            title: z.string(),
            position: z.number().nullable(),
            isCurrent: z.boolean(),
            isMine: z.boolean(),
            approvedBy: z.array(z.string()),
            threadsToAnswer: z.number(),
            /** Everything else waiting on me: changes requested, failing CI. */
            feedback: z.array(z.string()),
          }),
        ),
      }),
    ),
    fetchedAt: z.string(),
  }),
});
