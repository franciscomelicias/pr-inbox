import type { PaseoApi } from "@getpaseo/client";
import type { PreReviewQueue } from "../shared/pre-review";
import { fillPrompt } from "../shared/prompts";
import { getBoardState } from "./board";
import { readJson, writeJson } from "./cache";

const QUEUE_FILE = "pre-review-queue.json";
const REPO_PATH = "/Users/franciscomelicias/Documents/roger-platform";
const PROVIDER = "claude/claude-opus-5-5";
// Unattended runs: the skill reads code, makes a worktree and posts a pending review without asking.
const MODE = "auto";
const WORKSPACE_TITLE = "Pre-reviews";
// A review stuck far past this is left for me to look at, so the rest of the queue still runs.
const RUN_TIMEOUT_MS = 45 * 60 * 1000;

/** The running PR stays first in the saved list, with its agent, until its run ends: a restart waits on it again. */
interface Entry {
  number: number;
  agentId: string | null;
}

let queue: Entry[] | null = null;
let working = false;
let paseo: PaseoApi | null = null;

async function load(): Promise<Entry[]> {
  queue ??= await readJson<Entry[]>(QUEUE_FILE, []);
  return queue;
}

async function save(next: Entry[]): Promise<PreReviewQueue> {
  queue = next;
  await writeJson(QUEUE_FILE, next);
  return snapshot(next);
}

function snapshot(list: Entry[]): PreReviewQueue {
  const [head, ...rest] = list;
  return working && head ? { running: head.number, waiting: rest.map((entry) => entry.number) } : { running: null, waiting: list.map((entry) => entry.number) };
}

/** Every call hands over the daemon's API; the first one with work queued starts the worker. */
export async function getQueue(api: PaseoApi): Promise<PreReviewQueue> {
  paseo = api;
  void work();
  return snapshot(await load());
}

export async function enqueue(api: PaseoApi, numbers: number[]): Promise<PreReviewQueue> {
  paseo = api;
  const list = await load();
  const added = numbers.filter((number) => !list.some((entry) => entry.number === number));
  const result = await save([...list, ...added.map((number) => ({ number, agentId: null }))]);
  void work();
  return result;
}

/** Only a waiting PR can be removed; the running review is stopped from its agent. */
export async function dequeue(number: number): Promise<PreReviewQueue> {
  const list = await load();
  if (working && list[0]?.number === number) return snapshot(list);
  return save(list.filter((entry) => entry.number !== number));
}

async function work(): Promise<void> {
  if (working || !paseo) return;
  const api = paseo;
  working = true;
  try {
    for (let head = (await load())[0]; head !== undefined; head = (await load())[0]) {
      try {
        await runOne(api, head);
      } catch (error) {
        console.error(`[pr-inbox] pre-review of #${head.number} failed`, error);
      }
      await save((await load()).filter((entry) => entry.number !== head.number));
    }
  } finally {
    working = false;
  }
}

async function runOne(api: PaseoApi, head: Entry): Promise<void> {
  let agentId = head.agentId;
  if (!agentId) {
    const workspace = api.workspaces.ref(await reviewWorkspaceId(api));
    const agent = await workspace.agents.create({
      config: { provider: PROVIDER, modeId: MODE },
      title: `Pre-review PR #${head.number}`,
      prompt: fillPrompt((await getBoardState()).prompts, "preReview", { number: head.number }),
    });
    agentId = agent.id;
    await save((await load()).map((entry) => (entry.number === head.number ? { ...entry, agentId } : entry)));
  }
  await api.agents.ref(agentId).waitForFinish(RUN_TIMEOUT_MS);
}

/** All pre-reviews are chats in one workspace on the main checkout, instead of one workspace each. */
async function reviewWorkspaceId(api: PaseoApi): Promise<string> {
  const { entries } = await api.workspaces.list();
  const existing = entries.find((workspace) => workspace.title === WORKSPACE_TITLE && !workspace.archivingAt);
  if (existing) return existing.id;
  const created = await api.workspaces.create({ title: WORKSPACE_TITLE, source: { kind: "directory", path: REPO_PATH } });
  return created.id;
}
