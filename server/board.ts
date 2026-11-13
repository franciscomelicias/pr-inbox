import {
  boardStateSchema,
  DEFAULT_BOARD_STATE,
  type BoardState,
  type Row,
} from "../shared/board";
import { readJson, writeJson } from "./cache";
import { assignStacks, classify, myReviewOid, sortRows } from "./classify";
import { fetchDetails, fetchNewCommits, fetchTouchedPaths, listOpenPullRequests, resolveLogin } from "./github";
import { fallbackSummary, getSummaries } from "./summaries";

const STATE_FILE = "state.json";

type Board = Awaited<ReturnType<typeof buildBoard>>;

let latest: { at: number; board: Promise<Board> } | null = null;

/** Always refetches; the workspaces board reuses the result through getRecentBoard. */
export function fetchBoard(): Promise<Board> {
  const board = buildBoard();
  latest = { at: Date.now(), board };
  board.catch(() => {
    if (latest?.board === board) latest = null;
  });
  return board;
}

export function getRecentBoard(maxAgeMs: number): Promise<Board> {
  return latest && Date.now() - latest.at < maxAgeMs ? latest.board : fetchBoard();
}

async function buildBoard() {
  const [login, listed] = await Promise.all([resolveLogin(), listOpenPullRequests()]);
  const [details, paths] = await Promise.all([
    fetchDetails(listed.map((pr) => pr.number)),
    fetchTouchedPaths(listed),
  ]);
  const moved = details.flatMap((pr) => {
    const reviewOid = myReviewOid(pr, login);
    return reviewOid && reviewOid !== pr.headRefOid ? [{ number: pr.number, reviewOid, headOid: pr.headRefOid }] : [];
  });
  const [{ summaries, pending }, newCommits] = await Promise.all([getSummaries(details), fetchNewCommits(moved)]);

  const classified = details.map((pr) =>
    classify({
      pr,
      login,
      topLevelPaths: paths.get(pr.number) ?? [],
      newCommits: newCommits.get(pr.number) ?? null,
    }),
  );
  assignStacks(
    classified,
    new Map(listed.map((pr) => [pr.number, { head: pr.headRefName, base: pr.baseRefName }])),
  );
  const bodies = new Map(details.map((pr) => [pr.number, pr.body]));
  const rows: Row[] = sortRows(classified).map((row) => {
    const summary = summaries.get(row.number);
    return {
      ...row,
      summary: summary ?? fallbackSummary(bodies.get(row.number) ?? ""),
      summaryPending: summary === undefined,
    };
  });
  return { login, rows, summariesPending: pending, fetchedAt: new Date().toISOString() };
}

export async function getBoardState(): Promise<BoardState> {
  // Spread over the defaults so a state saved before a new filter existed still parses.
  const stored = boardStateSchema.safeParse({ ...DEFAULT_BOARD_STATE, ...(await readJson(STATE_FILE, {})) });
  return stored.success ? stored.data : DEFAULT_BOARD_STATE;
}

export async function setBoardState(state: BoardState): Promise<Record<string, never>> {
  await writeJson(STATE_FILE, state);
  return {};
}
