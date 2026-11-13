import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pressable, Text } from "react-native";
import { getVersionRpc, updateRpc } from "../shared/update";
import type { Styles } from "./styles";

/** `vX.Y.Z`, or the newer GitHub release with an Update button that pulls and reloads the plugin. */
export function VersionBadge({ styles }: { styles: Styles }) {
  const fetchVersion = useRpc(getVersionRpc);
  const runUpdate = useRpc(updateRpc);
  const version = useQuery({ queryKey: ["pr-inbox-version"], queryFn: () => fetchVersion({}), staleTime: Infinity });
  const update = useMutation({ mutationFn: () => runUpdate({}) });
  if (!version.data) return null;

  const { current, latest, url } = version.data;
  return (
    <>
      <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(url)}>
        <Text style={latest ? styles.badgeWarning : styles.muted}>
          {latest ? `v${current} · ⬆ v${latest} available` : `v${current}`}
        </Text>
      </Pressable>
      {latest && !update.data ? (
        <Pressable accessibilityRole="button" disabled={update.isPending} onPress={() => update.mutate()}>
          <Text style={styles.agentButton}>{update.isPending ? "Updating…" : "Update"}</Text>
        </Pressable>
      ) : null}
      {update.data ? <Text style={styles.muted}>{update.data.message}</Text> : null}
      {update.error ? <Text style={styles.error}>Update failed: {String(update.error)}</Text> : null}
    </>
  );
}
