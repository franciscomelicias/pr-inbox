import { useRpc, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { commentsToAnswerRpc } from "../../shared/board";

const POLL_MS = 15 * 60 * 1000;

/** "Workspaces" sidebar row with a bullet counting the review threads waiting on me. */
export function WorkspacesSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const commentsToAnswer = useRpc(commentsToAnswerRpc);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const poll = () => commentsToAnswer({}).then(({ count }) => setCount(count), () => {});
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [commentsToAnswer]);

  return (
    <SidebarRow
      icon="LayoutList"
      active={currentScreen?.screenId === "workspaces"}
      onPress={() => openScreen({ screenId: "workspaces" })}
      trailing={
        count > 0 ? (
          <Text
            accessibilityLabel={`${count} comments to answer`}
            style={{
              backgroundColor: theme.colors.statusWarning,
              color: theme.colors.surface0,
              borderRadius: 9,
              minWidth: 18,
              paddingHorizontal: 5,
              fontSize: 11,
              fontWeight: "600",
              textAlign: "center",
              overflow: "hidden",
            }}
          >
            {count}
          </Text>
        ) : null
      }
    />
  );
}
