# Structured script MR results

## Status

Accepted.

## Context

Sessions commonly create and update MRs through scripts that capture `glab`
subprocess output. Direct-command parsing misses those operations. A successful
wrapper exit does not mean every subprocess succeeded, and read-only API results
also contain valid MR URLs. General script interpretation would add complexity
without proving which operations ran or produced a result.

## Decision

Adopt results from literal supported script runners or script paths when they
report a JSON object or JSONL records. Each record must have numeric
`returncode: 0` and one unambiguous pair of captured streams: `stdout`/`stderr`
or `mr_stdout`/`mr_stderr`.

Without captured arguments, require a GitLab CLI creation banner in stderr that
matches the result URL's project, or an update banner in stdout that matches its
MR number. Adopt only the standalone final URL in that record's stdout.

When a record includes `args`, require a string array for `glab`. Quote those
arguments as literal data and reuse direct-operation validation. API updates
must match the PUT endpoint and returned MR identity. Invalid arguments do not
fall back to banner detection.

Use the shared reference detector for live events and complete family history
recovery. Validate adopted requests with the authenticated CLI and persist their
canonical URLs through the existing session-family store.

## Consequences

Existing captured creation and update results work without evaluating scripts.
Failed batch records, metadata URLs, title URLs, and ordinary read-only results
do not establish ownership. Raw or suppressed output still needs
[`/mr-track`](0001-explicit-session-mr-tracking.md).

The script's operation report is trusted input, not proof of execution. A script
that deliberately prints a saved successful mutation record can establish a
false link. Scripts must report results from the current invocation. This is not
an authorization boundary; remote lookup still uses the user's CLI credentials.
