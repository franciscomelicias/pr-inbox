# pr-inbox: Paseo plugin

Two sidebar pages for working through the open pull requests of `rogerhrgeneva/roger-platform`.

## Review board

Every open PR, sorted into **My PRs**, **Not reviewed**, **Back to me**, **With the author** and **Approved**.

- Focus chips, filters (drafts, ignored, stale, for release, areas, author, pre-reviewed) and collapsible sections,
  all saved by the daemon in `~/.cache/pr-inbox/state.json`.
- Each row: summary, reviewers and verdicts, CI, threads to answer, commits pushed since my review, stack position, notes.
- **Review / Fix**: opens a worktree on the PR branch with an agent briefed to review it, or to run `/review-plan` on my own PR.
- **Ask**: a read-only chat about the PR in the main checkout.
- **Pre-review**: queues `/review-like-francisco` runs in the daemon, one after the other, in a "Pre-reviews" workspace.
- **▸ Chat prompts** (top, collapsed): the prompt each of those buttons sends, editable, with
  `{{number}} {{title}} {{author}} {{repo}} {{newCommits}}` placeholders and a reset to default.

## Workspaces

Every Paseo workspace, grouped into **In progress**, **Finished**, **With comments**, **Reviewing others' PRs** and
**Merged / closed** (archive one or all).

- A workspace on a stacked branch lists each PR of its stack on its own line, bottom first; any line opens the workspace.
- Per PR: threads to answer, approvers, changes requested, failing CI.
- **Review plan** on a PR, or **Review plan (all N)** on a stack: starts a plan-mode agent in that workspace running
  `/review-plan`, reused if one is already open for the same PRs.

## Setup

Needs `gh` (logged in) and `git`. The repo path and the agent models are constants in `client/useReviewAgent.ts` and
`server/pre-review-queue.ts`.

```sh
npm install
npm run typecheck
paseo plugin reload pr-inbox
```

GitHub GraphQL is polled: the board build is cached (about 45 points per build), so keep nested connections small.
