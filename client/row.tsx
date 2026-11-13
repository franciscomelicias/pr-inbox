import { openExternalUrl } from "@getpaseo/plugin/client";
import { useState, type ComponentProps } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { Row } from "../shared/board";
import { PreReview } from "./pre-review";
import type { Styles } from "./styles";

export function PullRequestRow({
  row,
  styles,
  ignored,
  onToggleIgnore,
  onAgent,
  onAsk,
  agentPending,
  preReview,
  note,
  onSaveNote,
}: {
  row: Row;
  styles: Styles;
  ignored: boolean;
  onToggleIgnore: (() => void) | null;
  onAgent: (() => void) | null;
  onAsk: (() => void) | null;
  agentPending: boolean;
  preReview: Omit<ComponentProps<typeof PreReview>, "row" | "styles"> | null;
  note: string | null;
  onSaveNote: (note: string | null) => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const isMine = row.section === "mine";
  const approvers = row.reviewers.filter((reviewer) => reviewer.verdict === "APPROVED").map((r) => r.login);
  const blockers = row.reviewers.filter((reviewer) => reviewer.verdict === "CHANGES_REQUESTED").map((r) => r.login);
  const commenters = row.reviewers.filter((reviewer) => reviewer.verdict === "COMMENTED").map((r) => r.login);
  const pullUrl = (number: number) => row.url.replace(/\/pull\/\d+$/, `/pull/${number}`);

  return (
    <View style={[styles.row, ignored ? styles.rowIgnored : null]}>
      <View style={styles.rowTop}>
        <Pressable style={{ flexShrink: 1, flexGrow: 1 }} accessibilityRole="link" onPress={() => openExternalUrl(row.url)}>
          <Text style={styles.rowTitle}>
            #{row.number} {row.title}
          </Text>
        </Pressable>
        {isMine ? <Text style={styles.approvals}>✓ {approvers.length}</Text> : null}
      </View>

      {row.summary ? (
        <Text style={row.summaryPending ? styles.summaryPending : styles.summary}>{row.summary}</Text>
      ) : null}

      {editingNote ? (
        <NoteEditor
          initial={note ?? ""}
          onSave={(text) => {
            onSaveNote(text.trim() ? text.trim() : null);
            setEditingNote(false);
          }}
          onCancel={() => setEditingNote(false)}
          styles={styles}
        />
      ) : note ? (
        <View style={styles.note}>
          <Text selectable style={styles.noteText}>
            📝 {note}
          </Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => setEditingNote(true)}>
              <Text style={styles.link}>Edit note</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => onSaveNote(null)}>
              <Text style={styles.linkDanger}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.meta}>
        {row.author} · +{row.additions} −{row.deletions} · {row.changedFiles} files · opened {ago(row.createdAt)} ·
        updated {ago(row.updatedAt)}
        {row.myLastReviewAt && !isMine ? ` · my review ${ago(row.myLastReviewAt)}` : ""}
      </Text>

      <View style={styles.badges}>
        {row.forRelease ? <Text style={styles.badgeAccent}>for-release</Text> : null}
        {row.isDraft ? <Text style={styles.badge}>draft</Text> : null}
        {row.stack ? (
          <Pressable
            disabled={row.stack.below === null}
            onPress={() => row.stack?.below && openExternalUrl(pullUrl(row.stack.below))}
          >
            <Text style={styles.badge}>
              stack {row.stack.position}/{row.stack.size}
              {row.stack.below === null ? " · bottom" : ` · on #${row.stack.below}`}
            </Text>
          </Pressable>
        ) : null}
        {row.stackBlocked && row.stack?.position === 1 ? (
          <Text style={styles.badgeDanger}>CI failing · blocks {row.stack.size - 1} above</Text>
        ) : null}
        {!isMine && row.reviewRequestedAt ? (
          <Text style={requestStyle(row.reviewRequestedAt, styles)}>review requested {ago(row.reviewRequestedAt)}</Text>
        ) : null}
        {row.stale ? <Text style={styles.badge}>stale · no commit for 14d+</Text> : null}
        {blockers.length > 0 ? <Text style={styles.badgeDanger}>changes requested · {blockers.join(", ")}</Text> : null}
        {isMine && row.threadsToAnswer > 0 ? (
          <Text style={styles.badgeWarning}>{row.threadsToAnswer} threads to answer</Text>
        ) : null}
        {isMine && row.waitingForReview ? <Text style={styles.badge}>waiting for review</Text> : null}
        {!isMine && row.repliesWaiting > 0 ? (
          <Text style={styles.badgeWarning}>{row.repliesWaiting} replies waiting</Text>
        ) : null}
        {!isMine && row.myOpenThreads + row.myResolvedThreads > 0 ? (
          <Text style={styles.badge}>
            my threads {row.myOpenThreads} open · {row.myResolvedThreads} resolved
          </Text>
        ) : null}
        {row.pushedSinceMyReview ? (
          <Text style={styles.badgeWarning}>
            {row.newCommits.length === 0
              ? "pushed since my review"
              : `${row.newCommits.length} new commit${row.newCommits.length === 1 ? "" : "s"} since my review`}
          </Text>
        ) : null}
        {row.rebasedOnly ? <Text style={styles.badge}>rebased since my review</Text> : null}
        <CiBadge state={row.ci} styles={styles} />
        {row.areas.map((area) => (
          <Text key={area} style={styles.badge}>
            {area}
          </Text>
        ))}
      </View>

      {approvers.length + commenters.length > 0 ? (
        <Text style={styles.meta}>
          {approvers.length > 0 ? `Approved: ${approvers.join(", ")}` : ""}
          {approvers.length > 0 && commenters.length > 0 ? " · " : ""}
          {commenters.length > 0 ? `Commented: ${commenters.join(", ")}` : ""}
        </Text>
      ) : null}

      {row.newCommits.length > 0 ? <Text style={styles.meta}>New: {row.newCommits.join(" · ")}</Text> : null}

      <View style={styles.actions}>
          {!note && !editingNote ? (
            <Pressable accessibilityRole="button" onPress={() => setEditingNote(true)}>
              <Text style={styles.link}>📝 Add note</Text>
            </Pressable>
          ) : null}
          {onAsk ? (
            <Pressable accessibilityRole="button" disabled={agentPending} onPress={onAsk}>
              <Text style={styles.askButton}>💬 Ask about PR</Text>
            </Pressable>
          ) : null}
          {preReview ? <PreReview row={row} styles={styles} {...preReview} /> : null}
          {onAgent ? (
            <Pressable accessibilityRole="button" disabled={agentPending} onPress={onAgent}>
              <Text style={styles.agentButton}>
                {agentPending ? "Starting agent…" : isMine ? "✦ Address comments with agent" : "✦ Review with agent"}
              </Text>
            </Pressable>
          ) : null}
          {row.changesSinceUrl ? (
            <Pressable accessibilityRole="link" onPress={() => row.changesSinceUrl && openExternalUrl(row.changesSinceUrl)}>
              <Text style={styles.link}>Changes since my review ↗</Text>
            </Pressable>
          ) : null}
          {onToggleIgnore ? (
            <Pressable accessibilityRole="button" onPress={onToggleIgnore}>
              <Text style={styles.link}>{ignored ? "Stop ignoring" : "Ignore until next push"}</Text>
            </Pressable>
          ) : null}
      </View>
    </View>
  );
}

function NoteEditor({
  initial,
  onSave,
  onCancel,
  styles,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  styles: Styles;
}) {
  const [text, setText] = useState(initial);
  return (
    <View style={styles.note}>
      <TextInput
        autoFocus
        multiline
        value={text}
        onChangeText={setText}
        placeholder="Note to self: what to check, who to ping, what you already looked at…"
        placeholderTextColor={styles.muted.color}
        style={styles.noteInput}
      />
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => onSave(text)}>
          <Text style={styles.link}>Save note</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text style={styles.muted}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The longer a review request waits, the louder its badge. */
function requestStyle(requestedAt: string, styles: Styles) {
  const waited = Date.now() - new Date(requestedAt).getTime();
  if (waited < DAY_MS) return styles.badgeAccent;
  if (waited < 3 * DAY_MS) return styles.badgeWarning;
  return styles.badgeDanger;
}

function CiBadge({ state, styles }: { state: string | null; styles: Styles }) {
  if (state === null) return null;
  if (state === "SUCCESS") return <Text style={styles.badgeSuccess}>CI ✓</Text>;
  if (state === "FAILURE" || state === "ERROR") return <Text style={styles.badgeDanger}>CI ✗</Text>;
  return <Text style={styles.badgeWarning}>CI …</Text>;
}

function ago(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
