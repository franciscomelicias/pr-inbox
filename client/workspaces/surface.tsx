import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { CATEGORY_TITLES, classifyWorkspacesRpc, type Category } from "../../shared/workspaces";
import { createStyles, type Styles } from "../styles";
import { PROVIDER, reviewPlanPrompt, stackReviewPlanPrompt } from "../useReviewAgent";
import { useWorkspaces, type Workspace } from "./useWorkspaces";

type Entry = RpcOutput<typeof classifyWorkspacesRpc>["workspaces"][number];
type Layer = Entry["layers"][number];

const SECTION_ORDER: Category[] = ["inProgress", "finished", "withComments", "reviewing", "merged"];
const REFRESH_MS = 5 * 60 * 1000;

export function WorkspacesSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const classifyWorkspaces = useRpc(classifyWorkspacesRpc);
  const workspaces = useWorkspaces();
  const styles = useMemo(() => createStyles(theme.colors, layout.compact), [theme, layout.compact]);
  const [armed, setArmed] = useState<string | null>(null);

  const inputs = (workspaces ?? []).map((workspace) => ({
    id: workspace.id,
    branch: workspace.gitRuntime?.currentBranch ?? null,
    directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
  }));
  const classified = useQuery({
    queryKey: ["workspaces-classified", inputs.map((input) => `${input.id}:${input.branch}`).sort().join(",")],
    queryFn: () => classifyWorkspaces({ workspaces: inputs }),
    enabled: workspaces !== null && inputs.length > 0,
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
  });
  const archive = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.all(ids.map((id) => paseo.workspaces.archive(id)));
      const failed = results.filter((result) => result.error);
      if (failed.length > 0) throw new Error(failed.map((result) => result.error).join("; "));
    },
    onSettled: () => setArmed(null),
  });
  /** Reuses the workspace's review-plan agent for that PR, or starts one there. */
  const reviewPlan = useMutation({
    mutationFn: async ({ workspaceId, layers }: { workspaceId: string; layers: Layer[] }) => {
      const title = `Review plan PR ${layers.map((layer) => `#${layer.number}`).join(", ")}`;
      const prompt = layers.length === 1 ? reviewPlanPrompt(layers[0]) : stackReviewPlanPrompt(layers);
      const { entries } = await paseo.agents.list();
      const existing = entries
        .map((entry) => entry.agent)
        .find((agent) => agent.title === title && agent.workspaceId === workspaceId && !agent.archivedAt);
      const agent =
        existing ??
        (await paseo.workspaces.ref(workspaceId).agents.create({ config: { provider: PROVIDER, modeId: "plan" }, title, prompt }));
      navigation?.openAgent({ agentId: agent.id });
    },
  });

  const byId = new Map((workspaces ?? []).map((workspace) => [workspace.id, workspace]));
  const entries = (classified.data?.workspaces ?? []).flatMap((entry) => {
    const workspace = byId.get(entry.id);
    return workspace ? [{ ...entry, workspace }] : [];
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Workspaces</Text>
        {classified.error ? <Text style={styles.error}>{String(classified.error)}</Text> : null}
        {archive.error ? <Text style={styles.error}>{String(archive.error)}</Text> : null}
        {reviewPlan.error ? <Text style={styles.error}>{String(reviewPlan.error)}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={classified.isFetching}
          style={[styles.button, classified.isFetching ? styles.buttonDisabled : null]}
          onPress={() => void classified.refetch()}
        >
          <Text style={styles.buttonText}>{classified.isFetching ? "Loading…" : "Refresh"}</Text>
        </Pressable>
      </View>
      {workspaces === null || classified.isLoading ? <Text style={styles.muted}>Loading…</Text> : null}

      {SECTION_ORDER.map((category) => {
        const rows = entries.filter((entry) => entry.category === category);
        if (rows.length === 0) return null;
        const allKey = `all:${category}`;
        return (
          <View key={category} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{CATEGORY_TITLES[category]}</Text>
              <Text style={styles.sectionCount}>{rows.length}</Text>
              {category === "merged" ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={archive.isPending}
                  onPress={() => (armed === allKey ? archive.mutate(rows.map((row) => row.id)) : setArmed(allKey))}
                >
                  <Text style={armed === allKey ? styles.badgeDanger : styles.link}>
                    {armed === allKey ? `Confirm: archive all ${rows.length}` : "Archive all"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {rows.map((row) => (
              <WorkspaceRow
                key={row.id}
                workspace={row.workspace}
                branch={row.branch}
                pullRequest={row.pullRequest}
                reasons={row.reasons}
                stack={row.stack}
                layers={row.layers}
                reviewPlanPending={reviewPlan.isPending ? (reviewPlan.variables?.layers.map((layer) => layer.number) ?? null) : null}
                onReviewPlan={navigation ? (layers) => reviewPlan.mutate({ workspaceId: row.id, layers }) : null}
                tone={category === "withComments" ? "warning" : "normal"}
                archiveLabel={category === "merged" ? (armed === row.id ? "Confirm archive" : "Archive") : null}
                onArchive={() => (armed === row.id ? archive.mutate([row.id]) : setArmed(row.id))}
                onOpen={() => navigation?.openWorkspace({ workspaceId: row.id })}
                styles={styles}
              />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function WorkspaceRow({
  workspace,
  branch,
  pullRequest,
  reasons,
  stack,
  layers,
  reviewPlanPending,
  onReviewPlan,
  tone,
  archiveLabel,
  onArchive,
  onOpen,
  styles,
}: {
  workspace: Workspace;
  branch: string | null;
  pullRequest: { number: number; url: string; title: string } | null;
  reasons: string[];
  stack: Entry["stack"];
  layers: Layer[];
  reviewPlanPending: number[] | null;
  onReviewPlan: ((layers: Layer[]) => void) | null;
  tone: "warning" | "normal";
  archiveLabel: string | null;
  onArchive: () => void;
  onOpen: () => void;
  styles: Styles;
}) {
  const dirty = workspace.gitRuntime?.isDirty === true;
  const actionable = layers.filter((layer) => layer.isMine && (layer.threadsToAnswer > 0 || layer.feedback.length > 0));
  const isStarting = (target: Layer[]) => reviewPlanPending?.join() === target.map((layer) => layer.number).join();
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Pressable style={{ flexGrow: 1, flexShrink: 1 }} accessibilityRole="button" onPress={onOpen}>
          <Text style={styles.rowTitle}>{workspace.title ?? workspace.name}</Text>
        </Pressable>
        <Text style={statusStyle(workspace.status, styles)}>{workspace.status.replace("_", " ")}</Text>
      </View>
      <View style={styles.badges}>
        {branch ? <Text style={styles.meta}>{branch}</Text> : null}
        {stack ? <Text style={styles.badgeAccent}>Stack {stack.position}/{stack.size}</Text> : null}
        {onReviewPlan && actionable.length > 1 ? (
          <Pressable accessibilityRole="button" disabled={reviewPlanPending !== null} onPress={() => onReviewPlan(actionable)}>
            <Text style={styles.agentButton}>{isStarting(actionable) ? "Starting…" : `Review plan (all ${actionable.length})`}</Text>
          </Pressable>
        ) : null}
        {pullRequest && layers.length === 0 ? (
          <Pressable accessibilityRole="link" onPress={() => openExternalUrl(pullRequest.url)}>
            <Text style={styles.link}>
              #{pullRequest.number} {pullRequest.title}
            </Text>
          </Pressable>
        ) : null}
        {dirty ? <Text style={styles.badgeWarning}>uncommitted changes</Text> : null}
      </View>
      {layers.map((layer) => (
        <View key={layer.number} style={[styles.layer, layer.isCurrent && layers.length > 1 ? styles.layerCurrent : null]}>
          <Pressable style={{ flexGrow: 1, flexShrink: 1 }} accessibilityRole="button" onPress={onOpen}>
            <Text style={styles.rowTitle}>
              {layer.position !== null ? `${layer.position}. ` : ""}
              {layer.title}
            </Text>
          </Pressable>
          <View style={styles.badges}>
            <Pressable accessibilityRole="link" onPress={() => openExternalUrl(layer.url)}>
              <Text style={styles.link}>#{layer.number}</Text>
            </Pressable>
            {layer.isMine ? (
              <Text style={layer.threadsToAnswer > 0 ? styles.badgeWarning : styles.badge}>
                {layer.threadsToAnswer > 0 ? `💬 ${layer.threadsToAnswer} to answer` : "no comments"}
              </Text>
            ) : null}
            {layer.approvedBy.length > 0 ? (
              <Text style={styles.badgeSuccess}>✓ {layer.approvedBy.join(", ")}</Text>
            ) : (
              <Text style={styles.badge}>not approved</Text>
            )}
            {layer.feedback.map((reason) => (
              <Text key={reason} style={styles.badgeWarning}>
                {reason}
              </Text>
            ))}
            {onReviewPlan && actionable.includes(layer) ? (
              <Pressable accessibilityRole="button" disabled={reviewPlanPending !== null} onPress={() => onReviewPlan([layer])}>
                <Text style={styles.askButton}>{isStarting([layer]) ? "Starting…" : "Review plan"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      <Text style={tone === "warning" ? styles.badgeWarning : styles.meta}>{reasons.join(" · ")}</Text>
      {archiveLabel ? (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={onArchive}>
            <Text style={archiveLabel.startsWith("Confirm") ? styles.badgeDanger : styles.link}>
              {archiveLabel}
              {dirty && archiveLabel.startsWith("Confirm") ? " (uncommitted changes will be lost)" : ""}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function statusStyle(status: Workspace["status"], styles: Styles) {
  if (status === "running") return styles.badgeAccent;
  if (status === "needs_input" || status === "attention") return styles.badgeWarning;
  if (status === "failed") return styles.badgeDanger;
  return styles.badge;
}
