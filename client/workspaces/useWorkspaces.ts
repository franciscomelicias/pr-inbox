import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";

type Paseo = ReturnType<typeof usePaseo>;
export type Workspace = Awaited<ReturnType<Paseo["workspaces"]["list"]>>["entries"][number];

/** Live list of Paseo workspaces: initial snapshot plus streamed upserts and removals. */
export function useWorkspaces(): Workspace[] | null {
  const paseo = usePaseo();
  const [workspaces, setWorkspaces] = useState<Map<string, Workspace> | null>(null);

  useEffect(() => {
    let disposed = false;
    let release: (() => Promise<void>) | null = null;
    const unsubscribe = paseo.workspaces.subscribe((update) => {
      setWorkspaces((current) => {
        const next = new Map(current ?? []);
        if (update.kind === "upsert") next.set(update.workspace.id, update.workspace);
        else next.delete(update.id);
        return next;
      });
    });
    void paseo.workspaces.list({ subscribe: {} }).then(({ entries, subscription }) => {
      if (disposed) {
        void subscription.release();
        return;
      }
      release = () => subscription.release();
      setWorkspaces((current) => {
        const next = new Map(entries.map((workspace) => [workspace.id, workspace]));
        current?.forEach((workspace, id) => next.set(id, workspace));
        return next;
      });
    });
    return () => {
      disposed = true;
      void release?.();
      unsubscribe();
    };
  }, [paseo]);

  return workspaces ? [...workspaces.values()].filter((workspace) => !workspace.archivingAt) : null;
}
