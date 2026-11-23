# `@kitlangton/opencode-pr-tracker`

Tracks GitHub pull requests and GitLab merge requests created or updated by a
session or its subagents in the OpenCode V2 TUI sidebar. The checked-out branch
alone does not link a request to a session. Request state and CI status are
refreshed when the session tab is accessed and every 45 seconds while that
session is active. Polling stops when you leave the session or the sidebar is
removed. Merged and closed requests are
hidden. GitHub requests use `#123`; GitLab requests use `!123`.

The leading icon shows CI status for both draft and ready requests. Drafts also
show a blue `◇` next to the request number, so the draft marker does not hide
pending or failed CI.

Confirmed merge conflicts show a peach/orange `⚠` next to the request number, independently of the CI icon.
GitLab's conflict flag or detailed conflict status and GitHub's `CONFLICTING` mergeability state supply this marker.
Pending CI, missing approvals, and unknown mergeability do not count as conflicts. The marker clears on refresh when
the provider no longer reports a conflict.

Open GitLab merge requests show a green `✓` once a reviewer has approved and GitLab reports that all
approval requirements are met. The badge is independent of CI and conflicts, and clears when approval is removed.

The plugin adopts pull requests from successful `gh pr create`, `gh pr edit`,
and `gh api repos/<owner>/<repo>/pulls/<number>` commands, and merge requests from
successful `glab mr create`, `glab mr update`, and `glab api` PUT updates to
`projects/<project>/merge_requests/<number>`. API updates use the returned JSON MR
number and URL, including `jq` projections that preserve those fields. Requests
merely mentioned or viewed during research do not appear.

MR creation can use a multiline `--description "$(cat <<EOF …)"` with ordinary
text and simple shell variables. Quote the delimiter if the body contains
backticks, nested substitutions, or backslashes. A `glab mr update <full URL>`
under `set -e` or `set -euo pipefail` can also be followed by one `jq -e` file
check that prints `true`. The update must still print the matching GitLab
update banner and result URL. For shell loops, use the subprocess records below.

When a session opens, recovery reads its complete history and its subagents'
history, including nested subagents. You do not need to open each subagent's tab
first. Recovery is retried during polling if a history read fails, and unchanged
histories are reused instead of downloaded again.
Automatically adopted links are saved for the session family and survive TUI
restarts, even if history recovery is unavailable. Explicit request URLs remain
usable after their original worktree is removed.

Script-based calls are also adopted when the script prints a JSON object or
JSONL subprocess results with numeric `returncode: 0` and either `stdout`/`stderr`
or `mr_stdout`/`mr_stderr`. Python, Node, Bun, Deno, Ruby, Perl, shell runners,
and directly invoked script files are supported. Without captured `args`, a result needs the
CLI's creation banner for the returned project, or update banner for the returned
MR number, and a standalone final result URL in stdout. Failed batch entries,
read-only API responses, and URLs in titles or metadata do not establish a link.

Alternatively, include the subprocess's `args` array to identify the executed
`glab` operation. API updates require this array; the tracker checks the PUT
endpoint against the returned MR JSON. A successful `glab mr update <full URL>`
can be adopted even with empty captured streams. Captured arguments are treated
as literal data, not evaluated as shell code. For example:

```python
result = subprocess.run(command, capture_output=True, text=True)
print(json.dumps({
    "args": result.args,
    "returncode": result.returncode,
    "stdout": result.stdout,
    "stderr": result.stderr,
}))
```

Results must describe operations from that invocation, not replay saved results
as research. The tracker does not interpret scripts or infer inner success from
the wrapper's exit status. Raw output without an inner exit code, suppressed
output without a recoverable URL target, and unsupported script invocations
remain manual-only.

For these cases, run `/mr-track <GitLab MR URL>` in the owning session.
The command validates the MR with `glab` and saves its
canonical URL for that session family. Explicit links survive TUI restarts and
do not appear in unrelated sessions. Closed and merged MRs remain hidden. Running
the command from the palette prompts for a URL.

Run `/mr-untrack <GitLab MR URL or GitHub PR URL>` in the owning session to
remove one request link from that session family. Removal does not contact
GitHub or GitLab and does not change the remote request. The exclusion is saved
across restarts and prevents command or history recovery from restoring the
link. `/mr-track` can explicitly restore GitLab links. Other links and unrelated
session families are unchanged.

### Programmatic removal API

The server plugin exposes the typed RPC method `kit.pr-tracker.untrack`. It
accepts `{ sessionID: string, url: string }` and returns
`{ removed: boolean, rootSessionID: string }`. The server validates the session
and its location, and accepts full GitHub pull request URLs on `github.com` or
GitLab merge request URLs on GitLab hosts. It rejects credentials and
unsupported hosts. Trailing slashes, query strings, and fragments do not affect
the canonical request URL. The owning TUI plugin validates the same family and
location, then writes the exclusion to its own durable store. The call waits up
to 15 seconds for a TUI plugin at that location; it fails if no TUI instance is
connected. No server-side copy of the tracking store is created.

Configure the package's server entry in the server plugin list and its `./tui`
entry in the CLI plugin list. Then call the RPC at the exact session location:

```sh
opencode api post '/api/rpc/kit.pr-tracker/untrack?location[directory]=/workspace/project' \
  --data '{"input":{"sessionID":"ses_...","url":"https://github.com/phpstan/phpstan-doctrine/pull/814"}}'
```

The location must match the session's owning OpenCode location. The request
fails rather than changing another location or session family.

```jsonc
{
  "plugins": ["@kitlangton/opencode-pr-tracker"],
}
```

Requires `git` and the authenticated CLI for the host: `gh` for GitHub or `glab`
for GitLab. GitLab.com and self-managed GitLab instances are supported, including
private projects that your account can access. The plugin uses the CLI's existing
credentials; do not put tokens in plugin settings.

For a self-managed instance, authenticate once with your own hostname:

```sh
glab auth login --hostname code.example.com
```

`glab` selects the host and project from Git remotes and its configuration. An
adopted MR URL selects its own host and project, including nested groups. Numeric
`glab mr update` references also respect `--repo` / `-R`. GitLab pipeline states
are shown using the same status indicators as GitHub checks.

Only the CLI's result URL is adopted, not URLs echoed in titles. Command recovery
accepts quoted title and description payloads, including shell-generated
descriptions and `$'…'` strings, without evaluating them. The executable and MR
operation must remain literal. Quoted command examples, dynamic targets, redirects,
and shell syntax that cannot be parsed safely are not adopted without a supported
script subprocess result.
