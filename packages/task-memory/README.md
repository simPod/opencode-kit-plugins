# Task memory

A local OpenCode V2 trial for decisions, unanswered questions, and task checkpoints.
It makes no background model calls and does not extract state from your messages.
The agent updates records with tools; you can also update them from terminal commands.

## Install globally

From the workspace root:

```sh
bun install
bun run --filter '@simpod/opencode-task-memory' build
```

Add its absolute `dist` directory to the `plugins` array
in `~/.config/opencode/opencode.json`. Add the same directory to the `plugins`
array in `~/.config/opencode/cli.json` for the terminal sidebar and panel. Keep existing entries.

## Use

The existing right-hand sidebar shows a persistent compact summary: current task,
checkpoint, done/remaining counts, input requests, pending questions with blockers
highlighted, and the latest accepted decision and rejected alternative. It updates when records
change. Long text and extra questions are abbreviated; `/task-memory` shows the
full record. The host hides the sidebar on narrow terminals, where the composer
still shows blocking reminders.

Open `/task-memory` to see the current task, its checkpoint, decisions, and questions.
Ask the agent to create a task for substantial work, or use `/task-memory-new`.
Use `/task-memory-link` to connect another session in the same project to that task.
A new session is not linked automatically. Worktrees of the same project can share
task records; unrelated projects cannot.

The terminal also provides `/task-memory-decision`, `/task-memory-question`,
`/task-memory-answer`, and `/task-memory-checkpoint`. The panel keeps answered
questions and decision revisions in its history. Press `h` for history, `f` for
fullscreen, or Escape to close the panel. Checkpoint lists use semicolons between items.

The agent has two tools:

- `task_memory_view`: inspect the linked task or another task in this project.
- `task_memory_update`: create/link a task, record/revise a decision, record/answer
  a question, or append a checkpoint.

Each update records its session and time. No update deletes earlier decisions,
answers, or checkpoints. A completion checkpoint is rejected while remaining work,
input requests, or unanswered blocking questions exist. A later blocking question
makes the current task active again; historical checkpoints do not change.

## Limits and privacy

Blocking questions produce persistent reminders in the panel and model context.
They do not block shell commands or grant/revoke permissions. The agent can still
omit an update or enter incorrect information: inspect and correct the record.

Records are local plugin data, not repository files. Linked task context is included
in normal model requests and compaction as a bounded summary. Update responses contain
IDs and status, not full history; use the view tool or panel for complete inspection.
Read failures leave the safety instructions active and add an unavailable warning.
Failed writes remain errors. Do not enter credentials or secrets.
Concurrent location instances use the shared OpenCode server; using multiple private
servers against the same storage is not supported by this trial.

To disable the trial, remove its entries from both configuration files. Existing
records remain in plugin storage.

See [the architecture decision](../../docs/adr/0001-persistent-task-memory.md).

## Local checks

```sh
bun run --filter '@simpod/opencode-task-memory' check
uv run scripts/smoke-task-memory.py SESSION_ID OTHER_WORKTREE OTHER_PROJECT
```

The smoke check needs the installed trial and a linked `SESSION_ID`. It makes no
model requests, creates its own temporary session, and keeps the test task as history.
Successful checks mark it completed; failed checks keep it active. It checks sidebar
placement, live updates, narrow-terminal fallback, session switching, panel rendering,
and cancellation. It does not check every editing dialog submission, live model-context
injection, or actual compaction.
