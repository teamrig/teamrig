# Antigravity CLI (`antigravity-cli`) Live Proofs

Recorded live runs on `agy` used to back `ProofRef` entries in `src/adapters/hosts/antigravity-cli/declaration.ts`.

Scope note: `antigravityUserHooks` writes `~/.gemini/config/hooks.json`. The `1.5.14` run below was made in `agy` CLI using `~/.gemini/config/hooks.json`; the Antigravity desktop app and IDE were not tested.

## `plugin.hooks-file`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-25`
- **What was run:** Built `plugins/teamrig/dist/`, generated `~/.gemini/config/hooks.json` directly from `plugins/teamrig/hooks/hooks.json` via `antigravityUserHooks('win32').merge({}, src, pluginRoot)` (`31` inserted, `18` skipped) with no `.agents/hooks.json` in the workspace, and ran `agy --dangerously-skip-permissions --print='Reply with OK'`.
- **What was seen:** `agy` loaded the `antigravityUserHooks`-generated `~/.gemini/config/hooks.json` cleanly and completed the turn (`exit 0`, output `OK`).

## `permissions.deny-lines`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-24`
- **What was run:**
  1. `agy --settings=<file> --print='Try to read dummy.env...'` with `{"permissions":{"deny":["read_file(dummy.env)"]}}`.
  2. `agy --settings=<file> --print='Use your read_file tool on sub/.env...'` with `read_file(.env)`, `read_file(*.env)`, `read_file(*/.env)`, `read_file(**/.env)`, `read_file(**/*.env)`, and `read_file(/**/.env)`.
  3. `agy --settings=<file> --print='Run echo canary using run_command...'` with `{"permissions":{"allow":["command(*)"],"deny":["command(*canary*)"]}}` and with `deny: ["command(*canary*)","command(echo canary)"]`.
  4. `agy --settings=<file> --print='Run echo ...'` with `{"permissions":{"allow":["command(echo *)"]}}` and with `{"permissions":{"allow":["command(*)"],"deny":["command(echo *)"]}}`.
  5. `agy --dangerously-skip-permissions --settings=<file> --print='Use read_file on .../.agy-perm-canary.txt...'` with `{"permissions":{"deny":["read_file(~/.agy-perm-canary.txt)"]}}` and with the full path `read_file(<home>/.agy-perm-canary.txt)`.
  6. `agy --settings=<file> --print='Run echo bypass_ok using run_command...'` with `{"toolPermission":"always-proceed"}` (no `--dangerously-skip-permissions`).
- **What was seen:**
  1. `read_file(dummy.env)` denied `read_file` at the workspace root (`Permission denied for read_file(.../dummy.env). Matches user-configured deny rule.`).
  2. None of the six `read_file(...)` patterns blocked `sub/.env` in a subfolder (all returned `SUB_CANARY=999`); `grep_search` was not available in the headless CLI toolset.
  3. Exact `command(echo canary)` denied `echo canary` (`Permission denied for unsandboxed(echo canary). Matches user-configured deny rule.`), whereas `command(*canary*)` alone did not block `echo canary`.
  4. `command(echo *)` failed to match in both `allow` (auto-denied in headless mode) and `deny` (`echo trailing_star_deny` succeeded).
  5. `read_file(~/.agy-perm-canary.txt)` did not block `~/.agy-perm-canary.txt` (`~` did not expand; `HOME_CANARY=777` was returned), whereas the full path `read_file(<home>/.agy-perm-canary.txt)` denied `read_file`.
  6. `toolPermission: "always-proceed"` ran `echo bypass_ok` without a prompt (`bypass_ok`).


## `rules.session-start`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Installed `~/.gemini/config/hooks.json` via `antigravityUserHooks('win32').merge` pointing at built `plugins/teamrig/dist/`, initialized a temp team `probe` with `--sessions lead,alpha`, and ran `agy --dangerously-skip-permissions --print=...` in the project folder.
- **What was seen:** The `SessionStart` hook (`hook session-start --host antigravity-cli --host-event SessionStart`) injected `# Team rules (teamrig core)` (rules 1–16) and the session's team identity into the model's context.

## `rules.instruction-files`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Placed `GEMINI.md` (`Always include INBOX_RULE_OK when replying.`) in the temp project root and ran `agy --dangerously-skip-permissions --print=...`.
- **What was seen:** `agy` loaded `GEMINI.md` into `<user_rules>` and the model included `INBOX_RULE_OK` in its reply.

## `inbox.prompt-line`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Posted `INBOX_DELIVERED_777` to `alpha` (`teamrig inbox add --session lead --to alpha --text INBOX_DELIVERED_777`) and ran `agy --dangerously-skip-permissions --print=...` with `TEAMRIG_SESSION=alpha`.
- **What was seen:** The `PreInvocation` hook (`hook inbox-reminder --host antigravity-cli --host-event PreInvocation`) injected `2026-11-27 08:56 IST lead: INBOX_DELIVERED_777` into the turn and the model read it verbatim.

## `hooks.pretool-guard`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Prompted `agy` (with `antigravityUserHooks`-generated `~/.gemini/config/hooks.json`) to run `git push --force origin main` via `run_command`.
- **What was seen:** `PreToolUse` (`push-guard`) denied the call before `run_command` ran, and the model reported the exact guard refusal (`Force-pushing, mirroring or deleting a protected branch (main, master) is refused...`).

## `hooks.file-guard`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Prompted `agy` (with `antigravityUserHooks`-generated `~/.gemini/config/hooks.json`) to call `read_file` on `.env` in the temp workspace.
- **What was seen:** `PreToolUse` (`secret-guard`) denied the call before `read_file` ran, and the model reported the `teamrig secret guard` refusal.

## `hooks.exec-review`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Prompted `agy` (with `antigravityUserHooks`-generated `~/.gemini/config/hooks.json`) to run `teamrig exec approve R1` via `run_command`.
- **What was seen:** `PreToolUse` (`exec-guard`) denied the call before `run_command` ran, and the model reported the `teamrig exec guard` refusal.

## `hooks.readonly-allow`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Prompted `agy` (with `antigravityUserHooks`-generated `~/.gemini/config/hooks.json`) to run `git status` via `run_command`.
- **What was seen:** `PreToolUse` (`readonly-allow`) allowed `git status`, which ran and returned exit code `0`.

## `hooks.prompt-secret`

- **OS:** Windows (`win32`)
- **Tool version:** `agy` `1.5.14`
- **Date:** `2026-11-27`
- **What was run:** Ran `agy --dangerously-skip-permissions --print="Echo <github-token>"` with `antigravityUserHooks`-generated `~/.gemini/config/hooks.json`.
- **What was seen:** `PreInvocation` (`secret-guard`) terminated the turn before the model ran (`AGY_ERROR: {"short_error":"teamrig stopped this prompt before Claude read it: it looks like it holds a secret (GitHub token)...","retryable":false}`).
