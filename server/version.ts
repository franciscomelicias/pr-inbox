import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { VERSION } from "../shared/version";

const execFileAsync = promisify(execFile);
const REPO = "franciscomelicias/pr-inbox";
const CHECK_MS = 6 * 3600 * 1000;
// ponytail: the plugin API gives no install directory; assumes the ~/paseo-plugins clone, as the other paths here do.
const PLUGIN_DIR = join(homedir(), "paseo-plugins", "pr-inbox");
const GIT = ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"].find(existsSync) ?? "git";
const PASEO = "/Applications/Paseo.app/Contents/Resources/bin/paseo";

export type VersionInfo = { current: string; latest: string | null; url: string };

let checked: { at: number; latest: Promise<{ version: string; url: string } | null> } | null = null;

/** GitHub's latest release, checked at most every 6h; unauthenticated (60 calls/h), so a failure just means no warning. */
export async function getVersion(): Promise<VersionInfo> {
  const current = VERSION;
  if (!checked || Date.now() - checked.at > CHECK_MS) checked = { at: Date.now(), latest: latestRelease() };
  const latest = await checked.latest;
  return latest && compareVersions(latest.version, current) > 0
    ? { current, latest: latest.version, url: latest.url }
    : { current, latest: null, url: `https://github.com/${REPO}/releases` };
}

export async function update(): Promise<{ updated: boolean; message: string }> {
  const git = (...args: string[]) => execFileAsync(GIT, args, { cwd: PLUGIN_DIR, timeout: 60_000 });
  const before = (await git("rev-parse", "HEAD")).stdout.trim();
  await git("pull", "--ff-only", "origin", "main");
  const after = (await git("rev-parse", "HEAD")).stdout.trim();
  if (before === after) return { updated: false, message: "Already up to date" };
  const changed = (await git("diff", "--name-only", before, after)).stdout;
  // npm comes from nvm, which only an interactive shell loads; the daemon's PATH has neither.
  if (changed.includes("package-lock.json")) {
    await execFileAsync("/bin/zsh", ["-ilc", "npm install --no-audit --no-fund"], { cwd: PLUGIN_DIR, timeout: 5 * 60_000 });
  }
  checked = null;
  // Reloading stops this server, so it runs detached after the reply is sent.
  setTimeout(() => spawn(PASEO, ["plugin", "reload", "pr-inbox"], { detached: true, stdio: "ignore" }).unref(), 500);
  return { updated: true, message: "Updated, reloading…" };
}

function compareVersions(a: string, b: string): number {
  const parts = (version: string) => (/\d+(\.\d+)*/.exec(version)?.[0] ?? "0").split(".").map(Number);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function latestRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const release = (await response.json()) as { tag_name: string; html_url: string };
    return { version: release.tag_name.replace(/^v/, ""), url: release.html_url };
  } catch {
    return null;
  }
}
