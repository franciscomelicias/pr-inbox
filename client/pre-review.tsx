import { openExternalUrl } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";
import { Pressable, Text } from "react-native";
import type { Row } from "../shared/board";
import type { Styles } from "./styles";
import type { PreReviewAgent } from "./useReviewAgent";

/**
 * The select box and pre-review button, then the run's state. Done is read from GitHub (my pending review),
 * so it holds after a restart and clears by itself once I submit the review.
 */
export function PreReview({
  row,
  agent,
  running,
  queuePosition,
  selected,
  onToggleSelect,
  onStart,
  onDequeue,
  onOpenAgent,
  onFinished,
  styles,
}: {
  row: Row;
  agent: PreReviewAgent | null;
  /** The daemon's queue is on this PR now. */
  running: boolean;
  /** 1-based place among the waiting PRs; null when not queued. */
  queuePosition: number | null;
  selected: boolean;
  onToggleSelect: () => void;
  onStart: () => void;
  onDequeue: () => void;
  onOpenAgent: (agentId: string) => void;
  /** The run ended: refetch the board to see its pending review. */
  onFinished: () => void;
  styles: Styles;
}) {
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) onFinished();
    wasRunning.current = running;
  }, [running, onFinished]);

  const agentId = agent?.id ?? null;
  const attention = agent?.attentionReason ?? null;
  const open = () => agentId && onOpenAgent(agentId);
  const state = (() => {
    if (row.pendingReviewComments !== null) {
      return (
        <Pressable accessibilityRole="link" onPress={() => openExternalUrl(`${row.url}/files`)}>
          <Text style={styles.badgeSuccess}>
            ✓ Pre-reviewed · {row.pendingReviewComments} comment{row.pendingReviewComments === 1 ? "" : "s"} to finish ↗
          </Text>
        </Pressable>
      );
    }
    if (running) {
      return (
        <Pressable accessibilityRole="button" onPress={open}>
          <Text style={styles.badgeWarning}>⏳ Pre-reviewing…</Text>
        </Pressable>
      );
    }
    if (queuePosition !== null) {
      return (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove from the pre-review queue" onPress={onDequeue}>
          <Text style={styles.badgeAccent}>Queued · {ordinal(queuePosition)} ✕</Text>
        </Pressable>
      );
    }
    if (agent && (attention === "permission" || agent.status === "error")) {
      return (
        <Pressable accessibilityRole="button" onPress={open}>
          <Text style={styles.badgeDanger}>{agent.status === "error" ? "Pre-review failed · open" : "Pre-review needs you · open"}</Text>
        </Pressable>
      );
    }
    // Finished without a pending review: nothing to flag, or one of mine was already open there.
    if (agent && attention === "finished") {
      return (
        <Pressable accessibilityRole="button" onPress={open}>
          <Text style={styles.badge}>Pre-review done, no pending review · open</Text>
        </Pressable>
      );
    }
    return (
      <Pressable accessibilityRole="button" onPress={onStart}>
        <Text style={styles.askButton}>🔍 Pre-review</Text>
      </Pressable>
    );
  })();

  return (
    <>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onToggleSelect}>
        <Text style={selected ? styles.chipActive : styles.chip}>{selected ? "☑" : "☐"}</Text>
      </Pressable>
      {state}
    </>
  );
}

function ordinal(position: number): string {
  if (position % 100 >= 11 && position % 100 <= 13) return `${position}th`;
  return `${position}${["th", "st", "nd", "rd"][position % 10] ?? "th"}`;
}
