# Antigravity CLI (`antigravity-cli`) Live Proofs

Recorded live runs on `agy` used to back `ProofRef` entries in `src/adapters/hosts/antigravity-cli/declaration.ts`.

Scope note: `antigravityUserHooks` writes `~/.gemini/config/hooks.json`. The `1.5.14` run below was made in `agy` CLI using `~/.gemini/config/hooks.json`; the Antigravity desktop app and IDE were not tested.

## `plugin.hooks-file`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-25`
- **What was run:** Built `plugins/teamrig/dist/`, generated `~/.gemini/config/hooks.json` directly from `plugins/teamrig/hooks/hooks.json` via `antigravityUserHooks('win32').merge({}, src, pluginRoot)` (`31` inserted, `18` skipped) with no `.agents/hooks.json` in the workspace, and ran `agy --dangerously-skip-permissions --print='Reply with OK'`.
- **What was seen:** `agy` loaded the `antigravityUserHooks`-generated `~/.gemini/config/hooks.json` cleanly and completed the turn (`exit 0`, output `OK`).
