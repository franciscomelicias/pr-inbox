import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { BoardState } from "../shared/board";
import { DEFAULT_PROMPTS, PROMPT_KINDS, PROMPT_LABELS, PROMPT_PLACEHOLDERS, type PromptKind } from "../shared/prompts";
import type { Styles } from "./styles";

/** Collapsed by default: the prompt each board button sends to a new chat, editable. */
export function PromptsPanel({
  prompts,
  onSave,
  styles,
}: {
  prompts: BoardState["prompts"];
  onSave: (prompts: BoardState["prompts"]) => void;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<PromptKind, string>>>({});

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text style={styles.link}>▸ Chat prompts</Text>
      </Pressable>
    );
  }

  const saved = (kind: PromptKind) => prompts[kind] || DEFAULT_PROMPTS[kind];
  const save = (kind: PromptKind, text: string) => {
    const next = { ...prompts };
    if (text === DEFAULT_PROMPTS[kind]) delete next[kind];
    else next[kind] = text;
    onSave(next);
    setDrafts(({ [kind]: _, ...rest }) => rest);
  };

  return (
    <View style={styles.digest}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
        <Text style={styles.link}>▾ Chat prompts</Text>
      </Pressable>
      <Text style={styles.muted}>Placeholders: {PROMPT_PLACEHOLDERS}</Text>
      {PROMPT_KINDS.map((kind) => {
        const text = drafts[kind] ?? saved(kind);
        const isDirty = text !== saved(kind);
        return (
          <View key={kind} style={{ gap: 4 }}>
            <View style={styles.actions}>
              <Text style={styles.rowTitle}>{PROMPT_LABELS[kind]}</Text>
              {prompts[kind] ? <Text style={styles.badgeAccent}>edited</Text> : null}
            </View>
            <TextInput
              multiline
              value={text}
              onChangeText={(value) => setDrafts((current) => ({ ...current, [kind]: value }))}
              style={[styles.noteInput, { minHeight: 140, fontFamily: "monospace" }]}
            />
            <View style={styles.actions}>
              {isDirty ? (
                <>
                  <Pressable accessibilityRole="button" onPress={() => save(kind, text)}>
                    <Text style={styles.askButton}>Save</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setDrafts(({ [kind]: _, ...rest }) => rest)}>
                    <Text style={styles.link}>Cancel</Text>
                  </Pressable>
                </>
              ) : null}
              {prompts[kind] ? (
                <Pressable accessibilityRole="button" onPress={() => save(kind, DEFAULT_PROMPTS[kind])}>
                  <Text style={styles.linkDanger}>Reset to default</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
