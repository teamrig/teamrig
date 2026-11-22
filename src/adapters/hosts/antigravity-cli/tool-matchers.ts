/**
 * The tool matchers of teamrig's hooks file, rewritten in agy's tool names.
 *
 * teamrig's hooks file is Claude Code's, so its PreToolUse and PostToolUse matchers name Claude Code's tools
 * (`Bash|PowerShell`, `Read|Grep`, ...). agy matches a matcher against its own tool's name, such as `run_command`, so
 * a matcher left as it was never fires and the guard behind it never sees the call: a live agy 1.5.8 run let
 * `git push --force origin main` through that way. Each Claude Code tool here maps to the agy tools that do its job,
 * named from the tools this adapter's tool-call port reads; a tool agy has no counterpart for maps to none. A matcher
 * naming a tool this table does not know is refused, since a guess would either miss calls or guard the wrong tool.
 */

import type { AntigravityToolName } from './tool-call.ts';

const AGY_TOOLS_OF: Readonly<Record<string, readonly AntigravityToolName[]>> = {
  Bash: ['run_command'],
  PowerShell: ['run_command'],
  Read: ['view_file', 'read_file'],
  Grep: ['grep_search'],
  Glob: ['find_by_name', 'list_dir'],
  Write: ['write_to_file', 'write_file'],
  Edit: ['replace_file_content', 'edit_file'],
  MultiEdit: ['multi_replace_file_content'],
  NotebookEdit: [],
  WebFetch: ['read_url_content'],
  WebSearch: ['search_web'],
  Agent: ['invoke_subagent', 'swarm'],
  Task: ['invoke_subagent', 'swarm'],
  SendMessage: ['send_message'],
  AskUserQuestion: ['ask_question'],
  ExitPlanMode: [],
};

const EVERY_TOOL = '*';
const ALTERNATIVE = '|';

/**
 * agy's matcher for a Claude Code matcher: `*` stays `*`, and a `|` list of tool names becomes the `|` list of agy's
 * tools for them, each once, in the table's order. `matcher` is undefined when agy has no tool for any of them.
 */
export type AgyMatcher = { readonly ok: true; readonly matcher: string | undefined } | { readonly ok: false; readonly reason: string };

export function agyMatcherOf(matcher: string): AgyMatcher {
  if (matcher === EVERY_TOOL) {
    return { ok: true, matcher };
  }
  const tools = new Set<AntigravityToolName>();
  for (const name of matcher.split(ALTERNATIVE)) {
    const agyTools = Object.hasOwn(AGY_TOOLS_OF, name) ? AGY_TOOLS_OF[name] : undefined;
    if (agyTools === undefined) {
      return { ok: false, reason: `the matcher ${matcher} names ${name === '' ? 'an empty tool' : `the tool ${name}`}, which has no rule for an Antigravity tool` };
    }
    for (const tool of agyTools) {
      tools.add(tool);
    }
  }
  return { ok: true, matcher: tools.size === 0 ? undefined : [...tools].join(ALTERNATIVE) };
}
