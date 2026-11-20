---
"@kitlangton/opencode-pr-tracker": patch
---

Recognize GitLab merge requests created with multiline descriptions and updates
followed by a guarded `jq` check. Match the update output to the requested URL
before adding it to the sidebar.
