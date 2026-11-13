import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fetchBoard, getBoardState, setBoardState } from "./server/board";
import { classifyWorkspaces } from "./server/workspaces";
import { dequeue, enqueue, getQueue } from "./server/pre-review-queue";
import { boardRpc, getStateRpc, setStateRpc } from "./shared/board";
import { preReviewDequeueRpc, preReviewEnqueueRpc, preReviewQueueRpc } from "./shared/pre-review";
import { classifyWorkspacesRpc } from "./shared/workspaces";

export default function contribute(server: PluginServerContext) {
  server.handle(boardRpc, fetchBoard);
  server.handle(getStateRpc, getBoardState);
  server.handle(setStateRpc, setBoardState);
  server.handle(classifyWorkspacesRpc, classifyWorkspaces);
  server.handle(preReviewQueueRpc, (_input, { paseo }) => getQueue(paseo));
  server.handle(preReviewEnqueueRpc, ({ numbers }, { paseo }) => enqueue(paseo, numbers));
  server.handle(preReviewDequeueRpc, ({ number }) => dequeue(number));
  return () => {};
}
