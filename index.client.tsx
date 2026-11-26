import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BoardSurface } from "./client/board";
import { WorkspacesSidebarItem } from "./client/workspaces/sidebar-item";
import { WorkspacesSurface } from "./client/workspaces/surface";

export default function contribute(client: PluginClientContext) {
  client.addSurface("review-board", BoardSurface);
  client.addSidebarItem({
    id: "review-board",
    title: "Review board",
    icon: "GitPullRequest",
    surface: "review-board",
  });
  client.addSurface("workspaces", WorkspacesSurface);
  client.addSidebarHeaderItem({ id: "workspaces", title: "Workspaces", Component: WorkspacesSidebarItem });
  return () => {};
}
