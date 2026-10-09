# Persistent task memory

## Status

Accepted for the global local trial.

## Context

Unresolved findings can disappear into completed-task summaries and long
conversations. Repeating current approvals and progress in the sidebar does not
help the user find work that still needs action. Findings must survive task
completion without mixing unrelated tasks or inferring approval. Project-wide
defaults showed irrelevant findings in other sessions of the same repository.

## Decision

Provide one OpenCode V2 server plugin, findings sidebar, and full-record panel.
Keep append-only finding revisions in the project record, separate from linked
tasks. A finding is a bug, risk, or verification gap with evidence and a next
action. Its current status is open, resolved, or explicitly deferred. Preserve
origin session and optional origin task, including during corrections or reopening.

Show only open findings in the sidebar, not repeated approvals, questions,
decisions, or task progress. The full panel retains finding history and task data.
Expose structured tools and RPC methods for updates and inspection. Inject bounded
current task/session findings into model context. By default, filter on the finding's
original session or the selected task, not the latest revision author. Keep every
revision of matching findings. Unlinked sessions see only their own original findings.
An explicit `scope: project` read or all-project panel shows the complete project
list without changing sidebar or automatic context defaults. Revision counts from
inspection reject stale dialog writes inside the serialized update.
Task linking, decision revisions, question answers, and checkpoint history remain.
Return compact IDs and status from writes; full history is available for inspection.
Keep safety instructions and an explicit warning when reading the record fails.

Extend the existing v1 project document with a default-empty findings field so
previous trial records load without losing tasks. Upgrade the installed server and
terminal together; the older trial's strict schema cannot read the extended record.

Keep blocking questions visible in both the panel and model context. This is a
reminder system, not an authorization or command-execution security boundary.
Do not use background model calls or infer decisions from conversation text.

## Consequences

Findings remain stored when tasks finish. Explicitly linked sessions share findings
for that task, while unrelated sessions hide them by default. Project-wide inspection
remains available. Task state can be shared by explicitly linked sessions. The agent or
user must maintain it; an omitted update can leave stale information. Records
contain user-entered text and remain local, but linked task context is sent to the
selected model as ordinary session context, including scoped findings. Do not
store credentials in records. Finding status is a record, not proof of a fix or
permission to do unrelated work; agents must provide evidence and honor scope.
Removing the plugin from configuration disables it without deleting its records.
