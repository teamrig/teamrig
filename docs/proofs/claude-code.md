# Claude Code live proofs

The records behind the `proved on` cells of the Claude Code column in [Feature parity](../parity.md). Each heading is
a feature id; its record says where and on what it ran, what ran and what was seen. A proof is a run of teamrig's
own team on a real install, read from the session transcripts (each hook run is an `attachment` record, each refused
tool call a `tool_result` with its guard's words) and from the team's state files. A row with no record here stays
unproved on the page.

The 2026-11-20 records come from a scan of that day's 121 session transcripts of one team on Windows 11, Claude Code
2.1.329, teamrig 0.496.0. The 2026-11-23 records come from one session's own run that day, Claude Code 2.1.330,
teamrig 0.504.0.

## rules.session-start

- Windows 11, Claude Code 2.1.330, 2026-11-23.
- Ran: a session started fresh after a context refresh.
- Seen: the `SessionStart` hook's start note held the team rules, the session's id and name, its live tasks from the
  register and the week's budget line, before the first turn.

## rules.instruction-files

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: every session turn of the day.
- Seen: the transcripts' `instructions` records list the user's and the project's `CLAUDE.md` files read for the turn.

## inbox.prompt-line

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `UserPromptSubmit` hook `inbox-reminder`, 396 times.
- Seen: each new inbox line showed once at the next prompt, with a `+N more` line past the shown ones.

## context.size

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `Stop` hook at turn ends of sessions past their refresh threshold.
- Seen: 8 blocks naming the context size against its threshold (131k against a refresh at 130k).

## context.refresh

- Windows 11, Claude Code 2.1.330, 2026-11-23.
- Ran: a session's context was cleared (`SessionStart` source `clear`).
- Seen: the start note told the session to read its handover file, and the session took its work up from it.

## hooks.pretool-guard

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `PreToolUse` guards on Bash and PowerShell calls.
- Seen: 77 shell calls refused with the guard's reason (picker guard 70, config guard 4, package guard 3) and not run;
  a `cd` compound was refused before it ran.

## hooks.file-guard

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `PreToolUse` guards on reads.
- Seen: a Grep refused by the secret guard, and 3 calls refused by the pass-record guard.

## hooks.readonly-allow

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `PreToolUse` hook `readonly-allow`, 883 times.
- Seen: each answered `permissionDecision: allow`, and the read-only call ran with no permission prompt.

## hooks.tool-failure

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `PostToolUseFailure` hook `tool-end`, 113 times.
- Seen: each set the tab status for the failed call; 2 also added a hint for the session.

## permissions.auto-mode-routes

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `PreToolUse` hook `route-allow`, 36 times.
- Seen: each granted route answered `permissionDecision: allow`, and the call ran with no prompt.

## sessions.open

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: sessions opened by teamrig in their own tabs.
- Seen: each tab took the session's name as its title, and its transcript ran on the model and effort the launch
  settings named.

## sessions.resume

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: 12 session reopens.
- Seen: the session log recorded each `reopen`, one of them a resumed conversation that went on from its last turn.

## sessions.identity

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: sessions of the team on that day.
- Seen: each session's `CLAUDE_CODE_SESSION_ID` equalled the Claude session id teamrig recorded for it.

## sessions.wake

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: 190 wakes of idle sessions.
- Seen: a woken session took its next turn and answered its inbox line.

## sessions.turn-end

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `Stop` hook `stop`, 479 times.
- Seen: 205 turn ends carried a message for the session, and 35 were blocked with the reason (a wait, a context
  refresh, a handover to write).

## tabs.title-status

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the `SessionStart` hook `tab-status` 118 times, and the `PostToolUse` hook `tool-end` 5,696 times.
- Seen: each answered with the terminal sequence setting the tab's title and status circle.

## skills.plugin

- Windows 11, Claude Code 2.1.330, 2026-11-23.
- Ran: a session turn.
- Seen: the skill listing held the plugin's `teamrig:` skills.

## skills.team

- Windows 11, Claude Code 2.1.330, 2026-11-23.
- Ran: a session turn.
- Seen: the skill listing held the team's shared `team-` skills beside the session's own.

## skills.session-listing

- Windows 11, Claude Code 2.1.330, 2026-11-23.
- Ran: a session launched with teamrig's skill overrides.
- Seen: the listing showed the overridden skills by name only, and the others with their descriptions.

## plugin.hooks-file

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: every hook run of the day.
- Seen: each ran a command of the hooks file shipped in the installed plugin.

## plugin.cli-on-path

- Windows 11, Claude Code 2.1.330, 2026-11-23.
- Ran: `teamrig` commands from a session's PowerShell and Bash calls.
- Seen: each ran the installed plugin's CLI with no path given.

## os.windows-sessions

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: the team's sessions, each in its own Windows Terminal tab.
- Seen: the sessions ran natively on Windows, and each tab's title and status followed its session.

## os.windows-hooks

- Windows 11, Claude Code 2.1.329, 2026-11-20.
- Ran: every hook of the day on Windows: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure` and `Stop`.
- Seen: each answered in the shape its event takes (start notes, prompt lines, allow and refusal answers, terminal
  sequences, turn-end blocks).
