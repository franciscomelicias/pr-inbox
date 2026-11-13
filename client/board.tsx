import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { AREAS, boardRpc, SECTIONS, SECTION_TITLES, type BoardState, type Row } from "../shared/board";
import { FOCUSES, FOCUS_LABELS, matchesFocus } from "./focus";
import { missingItems, readyLabel } from "./missing";
import { PromptsPanel } from "./prompts-panel";
import { PullRequestRow } from "./row";
import { createStyles, type Styles } from "./styles";
import { useBoardState } from "./useBoardState";
import { useReviewAgent } from "./useReviewAgent";

const AUTO_REFRESH_MS = 30 * 60 * 1000;
const SUMMARY_POLL_MS = 20 * 1000;
const MAX_SUMMARY_POLLS = 6;

export function BoardSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const fetchBoard = useRpc(boardRpc);
  const summaryPolls = useRef(0);
  const board = useQuery({
    queryKey: ["pr-inbox-board"],
    queryFn: async () => {
      const data = await fetchBoard({});
      summaryPolls.current = data.summariesPending ? summaryPolls.current + 1 : 0;
      return data;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.summariesPending && summaryPolls.current <= MAX_SUMMARY_POLLS
        ? SUMMARY_POLL_MS
        : AUTO_REFRESH_MS,
  });
  const [state, updateState] = useBoardState();
  const reviewAgent = useReviewAgent(navigation, state.prompts);
  /** PRs ticked for a batch pre-review, in the order they were ticked. */
  const [selected, setSelected] = useState<number[]>([]);
  const styles = useMemo(() => createStyles(theme.colors, layout.compact), [theme, layout.compact]);

  const rows = board.data?.rows ?? [];
  const isIgnored = (row: Row) => state.ignored[row.number] === row.headOid;
  // An agent still listed counts too, so a PR stays "pre-reviewed" after its review is submitted.
  const isQueued = (row: Row) => reviewAgent.queue.running === row.number || reviewAgent.queue.waiting.includes(row.number);
  const isPreReviewed = (row: Row) =>
    row.pendingReviewComments !== null || reviewAgent.preReviews[row.number] !== undefined || isQueued(row);
  const passesToggles = (row: Row) =>
    (state.showDrafts || !row.isDraft) &&
    (state.showIgnored || !isIgnored(row)) &&
    (state.showStale || !row.stale || row.reviewRequested) &&
    (!state.forReleaseOnly || row.forRelease);
  const passesAreas = (row: Row) => state.areas.length === 0 || row.areas.some((area) => state.areas.includes(area));
  // Filters only narrow other people's PRs; my own always stay visible.
  const others = rows.filter((row) => row.section !== "mine" && passesToggles(row) && passesAreas(row));
  const byAuthor = others.filter((row) => state.author === null || row.author === state.author);
  const filtered = [
    ...rows.filter((row) => row.section === "mine"),
    ...byAuthor.filter((row) => state.preReview === "all" || isPreReviewed(row) === (state.preReview === "done")),
  ];
  const visible = filtered.filter((row) => matchesFocus(row, state.focus));
  // Drafts are left out (the skill skips them unless asked), and so are rows in collapsed sections.
  const unreviewedShown = visible.filter(
    (row) => row.section !== "mine" && !state.collapsed[row.section] && !row.isDraft && !isPreReviewed(row),
  );

  const toggleIgnore = (row: Row) => {
    const ignored = { ...state.ignored };
    if (isIgnored(row)) delete ignored[row.number];
    else ignored[row.number] = row.headOid;
    updateState({ ignored });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Review board</Text>
        {board.error ? <Text style={styles.error}>{String(board.error)}</Text> : null}
        {reviewAgent.error ? <Text style={styles.error}>{reviewAgent.error}</Text> : null}
        {board.data ? (
          <Text style={styles.muted}>Updated {new Date(board.data.fetchedAt).toLocaleTimeString()}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          disabled={board.isFetching}
          style={[styles.button, board.isFetching ? styles.buttonDisabled : null]}
          onPress={() => void board.refetch()}
        >
          <Text style={styles.buttonText}>{board.isFetching ? "Loading…" : "Refresh"}</Text>
        </Pressable>
      </View>

      <PromptsPanel prompts={state.prompts} onSave={(prompts) => updateState({ prompts })} styles={styles} />

      <View style={styles.focusBar}>
        {FOCUSES.map((focus) => (
          <Pressable key={focus} accessibilityRole="button" onPress={() => updateState({ focus })}>
            <Text style={state.focus === focus ? styles.focusChipActive : styles.focusChip}>
              {FOCUS_LABELS[focus]} {filtered.filter((row) => matchesFocus(row, focus)).length}
            </Text>
          </Pressable>
        ))}
      </View>

      {reviewAgent.available ? (
        <View style={styles.focusBar}>
          <Pressable
            accessibilityRole="button"
            disabled={unreviewedShown.length === 0}
            onPress={() => void reviewAgent.preReview(unreviewedShown.map((row) => row.number))}
          >
            <Text style={styles.askButton}>🔍 Pre-review all shown ({unreviewedShown.length})</Text>
          </Pressable>
          {selected.length > 0 ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void reviewAgent.preReview(selected);
                  setSelected([]);
                }}
              >
                <Text style={styles.askButton}>🔍 Pre-review {selected.length} selected</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setSelected([])}>
                <Text style={styles.link}>Clear selection</Text>
              </Pressable>
            </>
          ) : null}
          {reviewAgent.queue.running !== null ? (
            <Text style={styles.muted}>
              Pre-reviewing #{reviewAgent.queue.running}
              {reviewAgent.queue.waiting.length > 0 ? ` · ${reviewAgent.queue.waiting.length} waiting` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Filters
        state={state}
        updateState={updateState}
        areaCounts={countBy(
          rows.filter((row) => row.section !== "mine" && passesToggles(row)),
          (row) => row.areas,
        )}
        authorCounts={countBy(others, (row) => [row.author])}
        preReviewedCount={byAuthor.filter(isPreReviewed).length}
        notPreReviewedCount={byAuthor.filter((row) => !isPreReviewed(row)).length}
        styles={styles}
      />

      {board.isLoading ? <Text style={styles.muted}>Loading…</Text> : null}
      {board.data
        ? SECTIONS.map((section) => {
            const sectionRows = visible.filter((row) => row.section === section);
            const collapsed = state.collapsed[section] === true;
            if (state.focus !== "all" && sectionRows.length === 0) return null;
            return (
              <View key={section} style={styles.section}>
                <Pressable
                  accessibilityRole="button"
                  style={styles.sectionHeader}
                  onPress={() => updateState({ collapsed: { ...state.collapsed, [section]: !collapsed } })}
                >
                  <Text style={styles.sectionTitle}>
                    {collapsed ? "▸" : "▾"} {SECTION_TITLES[section]}
                  </Text>
                  <Text style={styles.sectionCount}>{sectionRows.length}</Text>
                </Pressable>
                {collapsed
                  ? null
                  : groupByStack(sectionRows).map((group) => {
                      const items = group.rows.map((row) => (
                        <PullRequestRow
                          key={row.number}
                          row={row}
                          styles={styles}
                          ignored={isIgnored(row)}
                          onToggleIgnore={section === "mine" ? null : () => toggleIgnore(row)}
                          onAgent={reviewAgent.available ? () => void reviewAgent.start(row) : null}
                          onAsk={reviewAgent.available ? () => void reviewAgent.ask(row) : null}
                          agentPending={reviewAgent.pending === row.number}
                          preReview={
                            reviewAgent.available && section !== "mine"
                              ? {
                                  agent: reviewAgent.preReviews[row.number] ?? null,
                                  running: reviewAgent.queue.running === row.number,
                                  queuePosition: queuePosition(reviewAgent.queue.waiting, row.number),
                                  selected: selected.includes(row.number),
                                  onToggleSelect: () =>
                                    setSelected(
                                      selected.includes(row.number)
                                        ? selected.filter((number) => number !== row.number)
                                        : [...selected, row.number],
                                    ),
                                  onStart: () => void reviewAgent.preReview([row.number]),
                                  onDequeue: () => void reviewAgent.unqueue(row.number),
                                  onOpenAgent: reviewAgent.openAgent,
                                  onFinished: () => void board.refetch(),
                                }
                              : null
                          }
                          note={state.notes[row.number] ?? null}
                          onSaveNote={(note) => {
                            const notes = { ...state.notes };
                            if (note === null) delete notes[row.number];
                            else notes[row.number] = note;
                            updateState({ notes });
                          }}
                        />
                      ));
                      if (group.root === null) return items;
                      const root = group.root;
                      const elsewhere = rows.filter((row) => row.stack?.root === root && row.section !== section);
                      const stackKey = `${section}:${root}`;
                      const stackCollapsed = state.collapsedStacks[stackKey] === true;
                      return (
                        <View key={`stack-${root}`} style={styles.stackGroup}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              updateState({ collapsedStacks: { ...state.collapsedStacks, [stackKey]: !stackCollapsed } })
                            }
                          >
                            <Text style={styles.stackHeader}>
                              {stackCollapsed ? "▸" : "▾"} Stack of {group.rows[0].stack?.size} · bottom #{root}
                              {elsewhere.length > 0
                                ? ` · also ${elsewhere.map((row) => `#${row.number} in ${SECTION_TITLES[row.section]}`).join(", ")}`
                                : ""}
                            </Text>
                          </Pressable>
                          {stackCollapsed ? <StackDigest rows={group.rows} notes={state.notes} styles={styles} /> : items}
                        </View>
                      );
                    })}
              </View>
            );
          })
        : null}
    </ScrollView>
  );
}

function Filters({
  state,
  updateState,
  areaCounts,
  authorCounts,
  preReviewedCount,
  notPreReviewedCount,
  styles,
}: {
  state: BoardState;
  updateState: (patch: Partial<BoardState>) => void;
  areaCounts: Map<string, number>;
  authorCounts: Map<string, number>;
  preReviewedCount: number;
  notPreReviewedCount: number;
  styles: Styles;
}) {
  const authors = [...authorCounts].sort(([a], [b]) => a.localeCompare(b));
  return (
    <View style={styles.filters}>
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Show</Text>
        <Chip label="Drafts" active={state.showDrafts} onPress={() => updateState({ showDrafts: !state.showDrafts })} styles={styles} />
        <Chip label="Ignored" active={state.showIgnored} onPress={() => updateState({ showIgnored: !state.showIgnored })} styles={styles} />
        <Chip label="Stale" active={state.showStale} onPress={() => updateState({ showStale: !state.showStale })} styles={styles} />
      </View>
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Only</Text>
        <Chip
          label="for-release"
          active={state.forReleaseOnly}
          onPress={() => updateState({ forReleaseOnly: !state.forReleaseOnly })}
          styles={styles}
        />
      </View>
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Pre-review</Text>
        <Chip label="All" active={state.preReview === "all"} onPress={() => updateState({ preReview: "all" })} styles={styles} />
        <Chip
          label={`Pre-reviewed ${preReviewedCount}`}
          active={state.preReview === "done"}
          onPress={() => updateState({ preReview: state.preReview === "done" ? "all" : "done" })}
          styles={styles}
        />
        <Chip
          label={`Not pre-reviewed ${notPreReviewedCount}`}
          active={state.preReview === "notDone"}
          onPress={() => updateState({ preReview: state.preReview === "notDone" ? "all" : "notDone" })}
          styles={styles}
        />
      </View>
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Area</Text>
        <Chip label="All" active={state.areas.length === 0} onPress={() => updateState({ areas: [] })} styles={styles} />
        {AREAS.filter((area) => areaCounts.has(area)).map((area) => (
          <Chip
            key={area}
            label={`${area} ${areaCounts.get(area)}`}
            active={state.areas.includes(area)}
            onPress={() =>
              updateState({
                areas: state.areas.includes(area) ? state.areas.filter((a) => a !== area) : [...state.areas, area],
              })
            }
            styles={styles}
          />
        ))}
      </View>
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Author</Text>
        <Chip label="All" active={state.author === null} onPress={() => updateState({ author: null })} styles={styles} />
        {authors.map(([author, count]) => (
          <Chip
            key={author}
            label={`${author} ${count}`}
            active={state.author === author}
            onPress={() => updateState({ author: state.author === author ? null : author })}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: Styles }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Text style={active ? styles.chipActive : styles.chip}>{label}</Text>
    </Pressable>
  );
}

function StackDigest({ rows, notes, styles }: { rows: Row[]; notes: Record<string, string>; styles: Styles }) {
  return (
    <View style={styles.digest}>
      {rows.map((row) => {
        const missing = missingItems(row);
        return (
          <Pressable key={row.number} accessibilityRole="link" onPress={() => openExternalUrl(row.url)}>
            <Text style={styles.digestLine} numberOfLines={2}>
              <Text style={styles.digestNumber}>
                {row.stack?.position}. #{row.number}
              </Text>
              {notes[row.number] ? " 📝" : ""}{" "}
              <Text style={styles.muted}>{row.title}</Text>
              {"  "}
              <Text style={missing.length > 0 ? styles.digestMissing : styles.digestReady}>
                {missing.length > 0 ? missing.join(" · ") : readyLabel(row)}
              </Text>
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Rows arrive with stack members already adjacent, bottom first; wrap each run of one stack together. */
function groupByStack(rows: Row[]): { root: number | null; rows: Row[] }[] {
  const groups: { root: number | null; rows: Row[] }[] = [];
  for (const row of rows) {
    const root = row.stack?.root ?? null;
    const last = groups.at(-1);
    if (root !== null && last?.root === root) last.rows.push(row);
    else groups.push({ root, rows: [row] });
  }
  return groups;
}

function queuePosition(waiting: number[], number: number): number | null {
  const index = waiting.indexOf(number);
  return index === -1 ? null : index + 1;
}

function countBy(rows: Row[], keys: (row: Row) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  rows.forEach((row) => keys(row).forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1)));
  return counts;
}
