import type { StepTexts } from '../../../plugin-api/index.ts';

/** How Codex CLI does the steps its declaration lists, printed by `teamrig skills step <id>`. */
export const stepTexts: StepTexts<'host'> = {
  'host.hooks-file':
    "`teamrig setup hooks --host codex` writes Codex CLI's `hooks.json` in `$CODEX_HOME` (default `~/.codex`). A second line sets the one setting the hooks need in `config.toml` beside it, `[features] unified_exec_tty = false`: Codex runs no hook on a line typed into an interactive shell, so teamrig turns those shells off (its own launcher passes the same setting). Codex applies a profile's features after the root ones, so the key is also turned off in each `[profiles.<name>.features]` that turns it on, and in each profile file `<name>.config.toml` (chosen with `codex -p <name>`) that does, each with its own backup `codex-<name>.config.toml.bak`; a profile entry that is no plain file is reported `SKIPPED`. The old `config.toml` is kept as `codex-config.bak` in the kit's `backups`. A `features = { ... }` inline table that may hold the key is refused with nothing written: set `unified_exec_tty = false` in it by hand. Codex runs a new or changed hook only once you trust it: open `/hooks` in Codex after every write and trust teamrig's hooks. They run teamrig's kit launcher, which names no version, so a teamrig update writes nothing and the trust holds.",
  'host.skills-folder':
    "`teamrig setup skills --host codex` copies teamrig's skills into `skills/teamrig` in `$CODEX_HOME` (default `~/.codex`), which Codex reads in every project. Codex reads its skills when a session starts: start a new Codex session after a copy to load the new ones.",
};
