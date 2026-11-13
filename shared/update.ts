import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const getVersionRpc = defineRpc({
  name: "version.get",
  input: z.object({}),
  output: z.object({ current: z.string(), latest: z.string().nullable(), url: z.string() }),
});

/** Pulls the latest main, installs if the lockfile changed, then reloads the plugin. */
export const updateRpc = defineRpc({
  name: "version.update",
  input: z.object({}),
  output: z.object({ updated: z.boolean(), message: z.string() }),
});
