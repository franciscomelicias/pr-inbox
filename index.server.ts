import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fetchBoard, getBoardState, setBoardState } from "./server/board";
import { classifyWorkspaces } from "./server/workspaces";
import { dequeue, enqueue, getQueue } from "./server/pre-review-queue";
import { boardRpc, getStateRpc, setStateRpc } from "./shared/board";
import { preReviewDequeueRpc, preReviewEnqueueRpc, preReviewQueueRpc } from "./shared/pre-review";
import { getVersionRpc, updateRpc } from "./shared/update";
import { classifyWorkspacesRpc } from "./shared/workspaces";
import { getVersion, update } from "./server/version";

export default function contribute(server: PluginServerContext) {
  server.handle(boardRpc, fetchBoard);
  server.handle(getStateRpc, getBoardState);
  server.handle(setStateRpc, setBoardState);
  server.handle(classifyWorkspacesRpc, classifyWorkspaces);
  server.handle(preReviewQueueRpc, (_input, { paseo }) => getQueue(paseo));
  server.handle(preReviewEnqueueRpc, ({ numbers }, { paseo }) => enqueue(paseo, numbers));
  server.handle(preReviewDequeueRpc, ({ number }) => dequeue(number));
  server.handle(getVersionRpc, getVersion);
  server.handle(updateRpc, update);
  return () => {};
}
