import type { StepTexts } from '../../../plugin-api/index.ts';

/** How Antigravity CLI does the steps its declaration lists, printed by `teamrig skills step <id>`. */
export const stepTexts: StepTexts<'host'> = {
  'host.hooks-file':
    "`teamrig setup hooks --host antigravity-cli` writes Antigravity CLI's `hooks.json` in `~/.gemini/config`. Start a new Antigravity session after a write to load the hooks.",
};
