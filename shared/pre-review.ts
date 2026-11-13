import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const queueSchema = z.object({
  /** The PR being pre-reviewed now. */
  running: z.number().nullable(),
  /** Waiting PRs, next first. */
  waiting: z.array(z.number()),
});

export type PreReviewQueue = z.infer<typeof queueSchema>;

export const preReviewQueueRpc = defineRpc({
  name: "pre-review.queue",
  input: z.object({}),
  output: queueSchema,
});

export const preReviewEnqueueRpc = defineRpc({
  name: "pre-review.enqueue",
  input: z.object({ numbers: z.array(z.number()) }),
  output: queueSchema,
});

export const preReviewDequeueRpc = defineRpc({
  name: "pre-review.dequeue",
  input: z.object({ number: z.number() }),
  output: queueSchema,
});
