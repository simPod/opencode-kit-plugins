# Explicit session MR tracking

## Status

Accepted.

## Context

A detached worktree has no branch for MR lookup. Bare URLs from Python or other
scripts cannot establish MR ownership safely. Adopting URLs from read-only
research would attach unrelated requests to a session.

## Decision

Add `/mr-track <URL>` as an explicit TUI action. Validate the MR with the existing
authenticated `glab` lookup before saving its canonical URL. Store manual links
in the plugin's durable `manual-mrs-v1` store, keyed by the session family's root
ID. Save automatically adopted links in the same durable store so they also
survive restart when history recovery is unavailable.

Add `/mr-untrack <URL>` to remove one GitLab MR link from the current session
family without contacting GitLab. Persist a canonical-URL exclusion beside the
links so automatic adoption and history recovery cannot restore the removed
association. Serialize local store mutations; an adoption already in progress
must re-check exclusions before updating runtime sidebar state. Explicitly
tracking that MR again removes its exclusion and restores the link. Other MRs
and other session families remain unchanged.

Recognize bounded script subprocess results as described in
[Structured script MR results](0002-structured-script-mr-results.md). Keep the
explicit action for scripts that do not provide this evidence.

## Consequences

Links survive TUI restarts without adopting arbitrary URL mentions. The
sidebar refreshes their current GitLab state and hides closed or merged MRs.
Links and exclusions are local to CLI storage and are not part of server session
exports. Exclusions apply only within one session family; a new explicit track
action opts that MR back in.
