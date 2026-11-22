import type { StepTexts } from '../../../features/steps.ts';

/** How Claude Code does the steps its declaration lists, printed by `teamrig skills step <id>`. */
export const stepTexts: StepTexts<'host'> = {
  'host.rename':
    'In Claude Code, type `/rename <new name>` in the session to rename it. Then run `teamrig rename <id|name> <new-name>` so the register and the inbox follow the new name, and run the steps it prints.',
  'host.slim-setup':
    'Claude Code reads every CLAUDE.md on the path to the working folder and the user\'s `~/.claude/CLAUDE.md` at each start, and lists every skill\'s name and description. Keep CLAUDE.md to rules needed on every turn; move the rest into `.claude/rules/*.md` files with a `paths:` list in their frontmatter, which load only when a matching file is read, or into a skill. A skill only a person starts takes `disable-model-invocation: true` in its frontmatter, which keeps it out of the listing.',
  'host.denial-sources':
    "Claude Code refuses a tool call from four places: the `permissions` deny and ask rules in the settings files (`~/.claude/settings.json`, the project's `.claude/settings.json` and `.claude/settings.local.json`, and any managed settings), a PreToolUse hook's answer, the auto mode classifier, and the person's own answer to a prompt. `/permissions` lists the rules in force and the file each came from; the refusal's own text in the session names the hook or the classifier. Read these before changing any rule.",
};
