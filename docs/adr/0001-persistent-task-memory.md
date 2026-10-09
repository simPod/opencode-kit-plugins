# Persistent task memory

## Status

Accepted for the global local trial.

## Context

Decisions, unanswered questions, and task progress are difficult to find in long
conversations. Compaction and work spread across sessions can hide important
context. The trial must not infer user approval or mix unrelated projects.

## Decision

Provide one OpenCode V2 server plugin and terminal panel. Keep versioned task
records in plugin storage, separated by project. Link sessions to tasks explicitly.
Expose structured tools and RPC methods for updates and inspection. Preserve
decision revisions, question answers, and checkpoint history. Inject the linked
task's bounded current context into model requests and compaction instructions.
Return compact IDs and status from writes; full history is available for inspection.
Keep safety instructions and an explicit warning when reading the record fails.

Keep blocking questions visible in both the panel and model context. This is a
reminder system, not an authorization or command-execution security boundary.
Do not use background model calls or infer decisions from conversation text.

## Consequences

Task state survives compaction and can be shared by linked sessions. The agent or
user must maintain it; an omitted update can leave stale information. Records
contain user-entered text and remain local, but linked task context is sent to the
selected model as ordinary session context. Do not store credentials in records.
Removing the plugin from configuration disables it without deleting its records.
