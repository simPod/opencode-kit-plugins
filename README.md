# OpenCode Plugins

Plugins for [OpenCode](https://opencode.ai) V2, including terminal plugins repaired
for OpenCode 2.0.24 and a task-memory trial checked with OpenCode 2.0.26.

Configure the PR tracker and session recap in `~/.config/opencode/cli.json`, not
in `opencode.json(c)`. They export `./tui` and share the terminal's Solid and
OpenTUI runtime. Task memory needs both configuration files. The published
0.1.1 PR tracker and 0.1.2 recap packages use the earlier
V2 preview layout; use the repaired local packages from this branch instead.

## Plugins

### [`@simpod/opencode-task-memory`](./packages/task-memory)

Global local trial for persistent open findings and task records.
Includes server tools, a findings sidebar, and a full-record panel. Unlike the plugins below, configure it
in both `opencode.json` and `cli.json`. Records are local and separated by project;
sessions link to tasks explicitly. See the package README for commands and limits.

### [`@kitlangton/opencode-pr-tracker`](./packages/pr-tracker)

Shows pull requests created by a session or its subagents in the sidebar, with
live GitHub and CI state.

```jsonc
{
  "plugins": ["/path/to/opencode-plugins/packages/pr-tracker/dist"]
}
```

### [`@kitlangton/opencode-session-recap`](./packages/session-recap)

Shows a one-sentence recap of your session above the composer, so you can remember where you left off after stepping away.

- `/recap` or the command palette generates one on demand.
- After three user turns, leaving the terminal unfocused for three minutes generates one automatically.
- New input dismisses it. Generation is read-only and never touches session history.

```jsonc
// cli.json
{
  "plugins": ["/path/to/opencode-plugins/packages/session-recap/dist"]
}
```

## Release

Add a changeset, push to `main`, then merge the release PR that CI opens:

```bash
bun run changeset
git push
```

Publishing runs in GitHub Actions through npm trusted publishing (OIDC). No tokens, no OTP.

## Local development

Install dependencies and build the local packages:

```sh
bun install
bun run --filter '*' build
```

Point the `cli.json` plugin list at the built `dist` directories:

```jsonc
{
  "plugins": [
    "/path/to/opencode-plugins/packages/pr-tracker/dist",
    "/path/to/opencode-plugins/packages/session-recap/dist"
  ]
}
```

The build transforms JSX but does not bundle the host's rendering dependencies.
It writes a neighboring `tui.js` entrypoint for local directory discovery.
Rebuild after editing source. Open `/plugins` in the TUI to confirm that both
plugins appear under **TUI**, not **Server**, and have no failure state.

With the local packages configured, run the loader regression check:

```sh
uv run scripts/smoke-tui.py
```

This opens a separate terminal client and checks the real `/plugins` view.
It does not send a model prompt or restart the shared server. It checks plugin
loading, not recap generation or GitHub status refresh.
