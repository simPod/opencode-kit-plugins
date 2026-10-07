# `@kitlangton/opencode-pr-tracker`

Tracks pull requests created by a session or its subagents in the OpenCode V2
TUI sidebar, with GitHub state and CI status refreshed while the session is
active.

The plugin adopts pull requests only from successful `gh pr create` shell or
tool output, so pull requests merely mentioned during research do not appear.

This branch repairs the published 0.1.1 package for OpenCode 2.0.24. Build locally
as described in the root README. Add this CLI-only plugin to
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/path/to/opencode-plugins/packages/pr-tracker/dist"]
}
```

Requires `git` and the authenticated GitHub CLI (`gh`).
