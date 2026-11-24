# Codex CLI live proofs

The records behind the `proved on` cells of the Codex CLI column in [Feature parity](../parity.md). Each heading is a
feature id; its record says where and on what it ran, what ran and what was seen. A row with no record here stays
unproved on the page.

The 2026-11-24 records come from one run on Windows 11, Codex CLI 0.171.0-alpha.13, teamrig 0.507.0: `codex exec` in
the `workspace-write` sandbox with no bypass flag, on a throwaway Codex home and a throwaway team whose `hosts` lists
`codex-cli`. `teamrig setup hooks --host codex` wrote 42 handlers into that home's `hooks.json`, each with
`--host codex-cli`, and they were trusted in `config.toml` before the run.

## rules.session-start

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: a fresh `codex exec` asked whether it had the team's rules.
- Seen: Codex printed the `SessionStart` hook as `Completed`; the model answered yes and quoted team rule 1 word for
  word from the start note.

## inbox.prompt-line

- Windows 11, Codex CLI 0.171.0-alpha.13, 2026-11-24.
- Ran: an inbox line posted to the session's own id with `teamrig inbox add`, then a `codex exec` prompt asking for
  the word in its newest inbox line.
- Seen: Codex printed the `UserPromptSubmit` hooks as `Completed`; the model quoted the posted line, its time, sender
  and text, from the prompt's inbox line.
