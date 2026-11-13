# @kitlangton/opencode-pr-tracker

## Unreleased

- Add `/mr-untrack <GitLab MR URL>` to remove a request from one session family.
  Persist exclusions to prevent automatic or historical recovery from restoring
  the link; explicitly tracking the MR again clears its exclusion.
- Expose the same operation through the `kit.pr-tracker.untrack` server RPC,
  which validates the session location and waits for the owning TUI plugin to
  persist the removal.

## 0.1.1

### Patch Changes

- 43da614: Keep pull requests scoped to the root session that created them and remove the current-branch prompt footer indicator.

## 0.1.0

### Minor Changes

- 66ec23a: Add the session-aware pull request tracker and update session recap to load its TUI implementation through the current hierarchical slot API.
