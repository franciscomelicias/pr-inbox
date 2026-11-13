import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DEFAULT_BOARD_STATE, getStateRpc, setStateRpc, type BoardState } from "../shared/board";

/** Filters, collapsed sections and ignored PRs, persisted by the daemon so they survive app restarts. */
export function useBoardState(): [BoardState, (patch: Partial<BoardState>) => void] {
  const getState = useRpc(getStateRpc);
  const saveState = useRpc(setStateRpc);
  const stored = useQuery({ queryKey: ["pr-inbox-state"], queryFn: () => getState({}), staleTime: Infinity });
  const [local, setLocal] = useState<BoardState | null>(null);
  const state = local ?? stored.data ?? DEFAULT_BOARD_STATE;

  const update = (patch: Partial<BoardState>) => {
    const next = { ...state, ...patch };
    setLocal(next);
    void saveState(next);
  };
  return [state, update];
}
