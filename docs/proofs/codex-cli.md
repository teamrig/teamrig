# Codex CLI live proofs

The records behind the `proved on` cells of the Codex CLI column in [Feature parity](../parity.md). Each heading is a
feature id; its record says where and on what it ran, what ran and what was seen. A row with no record here shows
built, not proven live on the page.

The records come from one live run on 2026-11-24: Windows 11, Codex CLI 0.171.0-alpha.13 (`codex exec` with
`-s workspace-write` and no bypass flag, and one interactive Codex session), teamrig 0.507.0, a throwaway team whose
`hosts` lists only `codex-cli`, its Codex home and project in scratch folders.

## plugin.hooks-file

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: teamrig wrote the team's hooks for Codex into the Codex home.
- Seen: `hooks.json` held 42 handlers, each run with `--host codex-cli` and none naming `claude-code`; `config.toml`
  held a `trusted_hash` for each of the 42 and `unified_exec_tty = false` under `[features]`.

## rules.session-start

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: a `codex exec` turn asking whether the team rules were in its context.
- Seen: the `SessionStart`, `UserPromptSubmit` and `Stop` hooks each completed, and the model answered yes, quoting
  rule 1.

## inbox.prompt-line

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: a line posted to the session's inbox inside the throwaway team, then a `codex exec` turn.
- Seen: the `UserPromptSubmit` hook completed, and the model quoted the posted line word for word.

## hooks.file-guard

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: an `apply_patch` call writing a GitHub-token-shaped text into a plain file.
- Seen: Codex printed `Command blocked by PreToolUse hook: teamrig secret guard: the text this call writes holds a
  secret (GitHub token)`, and the file was not written.

## hooks.pretool-guard

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: `git push origin main` through Codex's `exec_command` tool.
- Seen: Codex printed `Command blocked by PreToolUse hook: This push updates a protected branch (main, master)`, and
  the remote still had no branch.

## os.windows-hooks

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: every record above, on Windows.
- Seen: each hook ran with `--host codex-cli`, replied in Codex's shape, and Codex honoured the reply.
