---
"@kitlangton/opencode-pr-tracker": patch
---

Recover merge requests created or updated through script subprocess results,
including successful entries in JSONL batches. Require inner command success
and operation identity so failed commands and read-only API results do not
establish session ownership.
