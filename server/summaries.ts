import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "./cache";

const CACHE_FILE = "summaries-en.json";
const BATCH_SIZE = 10;
const MAX_BODY_CHARS = 3000;
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;
const CLAUDE =
  [join(homedir(), ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].find(existsSync) ??
  "claude";

const SYSTEM_PROMPT = `You summarize GitHub pull requests of an HR software monorepo for a code reviewer.
For each PR, write ONE plain English sentence (at most 25 words) saying what the change does for the product or codebase.
No markdown, no PR number, no ticket id, do not start with "This PR". Return one entry per input number.`;

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    summaries: {
      type: "array",
      items: {
        type: "object",
        properties: { number: { type: "integer" }, summary: { type: "string" } },
        required: ["number", "summary"],
      },
    },
  },
  required: ["summaries"],
});

export interface SummaryInput {
  number: number;
  title: string;
  body: string;
}

let inFlight: Promise<void> | null = null;
let lastFailureAt = 0;

/** Cached summaries keyed by title + body hash; missing ones are generated in the background. */
export async function getSummaries(prs: SummaryInput[]): Promise<{ summaries: Map<number, string>; pending: boolean }> {
  const cache = await readJson<Record<string, string>>(CACHE_FILE, {});
  const summaries = new Map<number, string>();
  const missing = prs.filter((pr) => {
    const cached = cache[hash(pr)];
    if (cached) summaries.set(pr.number, cached);
    return !cached;
  });
  const canRetry = Date.now() - lastFailureAt > FAILURE_BACKOFF_MS;
  if (missing.length > 0 && !inFlight && canRetry) {
    inFlight = generate(missing).finally(() => {
      inFlight = null;
    });
  }
  return { summaries, pending: missing.length > 0 && (inFlight !== null || canRetry) };
}

/** Until Claude answers: the first sentence of the description that reads like prose. */
export function fallbackSummary(body: string): string {
  const prose = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /[a-zA-Z]{3}/.test(line) && !/^(#|!\[|\||- \[|```|<)/.test(line))
    .map((line) => line.replace(/^[-*>]\s*/, "").replace(/[*_`]/g, ""))[0];
  if (!prose) return "";
  const sentence = prose.match(/^.{20,}?[.!?](\s|$)/)?.[0] ?? prose;
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence.trim();
}

async function generate(prs: SummaryInput[]): Promise<void> {
  for (let index = 0; index < prs.length; index += BATCH_SIZE) {
    const batch = prs.slice(index, index + BATCH_SIZE);
    try {
      const answers = await askClaude(batch);
      const cache = await readJson<Record<string, string>>(CACHE_FILE, {});
      for (const pr of batch) {
        const summary = answers.get(pr.number);
        if (summary) cache[hash(pr)] = summary;
      }
      await writeJson(CACHE_FILE, cache);
    } catch (error) {
      lastFailureAt = Date.now();
      console.error("[pr-inbox] summary generation failed", error);
      return;
    }
  }
}

function askClaude(batch: SummaryInput[]): Promise<Map<number, string>> {
  const input = JSON.stringify(
    batch.map((pr) => ({ number: pr.number, title: pr.title, description: pr.body.slice(0, MAX_BODY_CHARS) })),
  );
  // No --bare: it disables the OAuth login, and this runs on the user's subscription.
  const args = [
    "-p",
    "--model",
    "haiku",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--system-prompt",
    SYSTEM_PROMPT,
    "--json-schema",
    SCHEMA,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      try {
        const output: { summaries: { number: number; summary: string }[] } = JSON.parse(stdout).structured_output;
        resolve(new Map(output.summaries.map((entry) => [entry.number, entry.summary])));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

function hash(pr: SummaryInput): string {
  return createHash("sha256").update(`${pr.title}\n${pr.body}`).digest("hex").slice(0, 16);
}
