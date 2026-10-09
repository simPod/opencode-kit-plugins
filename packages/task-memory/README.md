# Task memory

A local OpenCode V2 trial for unresolved findings, decisions, questions, and checkpoints.
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

The right-hand sidebar shows **Open findings**: bugs, risks, and missing verification
that still need action. It does not repeat approvals, questions, decisions, or task
progress already visible in chat. By default, it includes findings first recorded
in this session or for the current linked task. Long lists are abbreviated;
`/task-memory` shows the relevant findings and evidence. The host hides the sidebar
on narrow terminals.

Findings are stored by project with their original session and optional task.
They survive task completion. Explicitly linked sessions share task findings;
unlinked sessions see only findings originally recorded in that session.
Revising a finding from another session does not change its origin or visibility.
Each correction appends a revision.
Resolving a finding needs evidence of a fix or verification; deferring one needs
explicit user agreement. Resolved and deferred entries leave the open list but
remain in history. A deferred entry can be reopened.

Use `/task-memory-finding` to add, correct, resolve, defer, or reopen a finding.
Use `/task-memory-project` to inspect **all project findings**, or press `p` in the
panel to switch scope. This explicit view does not change the sidebar or automatic
agent context. The finding picker also offers an explicit all-project option.
Open `/task-memory` to see findings and the current task's full record.
Ask the agent to create a task for substantial work, or use `/task-memory-new`.
Use `/task-memory-link` to connect another session in the same project to that task.
A new session is not linked automatically. Worktrees of the same project can share
task records; unrelated projects cannot.

The terminal also provides `/task-memory-decision`, `/task-memory-question`,
`/task-memory-answer`, and `/task-memory-checkpoint`. The panel keeps answered
questions and decision revisions in its history. Press `h` for history, `f` for
fullscreen, or Escape to close the panel. Checkpoint lists use semicolons between items.

The agent has two tools:

- `task_memory_view`: inspect current task/session findings and task data. Pass
  `scope: "project"` for explicit all-project inspection. `taskID` inspects another
  task without linking and includes that task's findings.
- `task_memory_update`: record/revise a finding, create/link a task, record/revise a
  decision, record/answer a question, or append a checkpoint.

The `finding` operation takes `kind` (`bug`, `risk`, `verification`), `status`
(`open`, `resolved`, `deferred`), `text`, and `reason` (evidence and next action).
New findings must be open. Supply `findingID` to revise an existing finding.
`expectedRevision` is the number of recorded revisions for that finding; provide
it to reject stale writes. Terminal dialogs use this check automatically.
No task link is required. Inspect first and revise matching entries instead of
creating duplicates. Findings do not authorize unrelated repair work.

Each update records its session and time. No update deletes earlier decisions,
answers, or checkpoints. A completion checkpoint is rejected while remaining work,
input requests, or unanswered blocking questions exist. A later blocking question
makes the current task active again; historical checkpoints do not change.

## Limits and privacy

Blocking questions produce persistent reminders in the panel and model context.
They do not block shell commands or grant/revoke permissions. The agent can still
omit an update or enter incorrect information: inspect and correct the record.

Records are local plugin data, not repository files. Only current task/session
findings and linked task context are included automatically in normal model requests
and compaction, as bounded summaries. Explicit project reads become ordinary tool
output in the requesting conversation. Update responses contain
IDs and status, not full history; use the view tool or panel for complete inspection.
Read failures leave the safety instructions active and add an unavailable warning.
Failed writes remain errors. Do not enter credentials or secrets.
Previous trial records load with an empty finding list. Upgrade server and terminal
together; reverting to the older strict schema after storing findings is not supported.
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
placement, live updates, narrow-terminal fallback, session isolation, explicit project
inspection, task-link sharing, panel rendering, and finding dialog submissions.
It does not check every task-editing dialog submission, live model-context
injection, or actual compaction.
