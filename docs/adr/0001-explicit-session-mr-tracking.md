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

Recognize bounded script subprocess results as described in
[Structured script MR results](0002-structured-script-mr-results.md). Keep the
explicit action for scripts that do not provide this evidence.

## Consequences

Links survive TUI restarts without adopting arbitrary URL mentions. The
sidebar refreshes their current GitLab state and hides closed or merged MRs.
Links are local to the CLI storage and are not part of server session exports.
There is no command to remove an explicit link yet.
