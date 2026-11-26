# GitHub live proofs

The records behind the `proved on` cells of the GitHub column in [Feature parity](../parity.md). Each heading is a
feature id; its record says where and on what it ran, what ran and what was seen. A proof is a run of teamrig's own
team against its public repositories, read from the team's GitHub state files (`state/github-*.json`, the CI
excerpts in `state/github-ci/`) and its sessions' inboxes. A row with no record here shows built, not proven live on the page.

The 2026-11-23 records come from that day's runs of one team on Windows 11, gh 2.101.0, teamrig 0.504.0, against
`teamrig/teamrig`.

## tracker.issue-import

- Windows 11, gh 2.101.0, 2026-11-23.
- Ran: the automatic issue sync, its last pass ending 13:14 IST.
- Seen: the sync state held each issue of the repository with its open state and labels, such as
  [#633](https://github.com/teamrig/teamrig/issues/633) open with `enhancement` and `p3`, and closed issues marked
  closed.

## tracker.watch

- Windows 11, gh 2.101.0, 2026-11-23.
- Ran: `issue watch`, started by teamrig 0.504.0 and left running.
- Seen: its state file named the running watcher and its kit version, its last beat at 13:14 IST, the minute the last
  sync pass ended.

## tracker.clocks

- Windows 11, gh 2.101.0, 2026-11-23.
- Ran: the response clock inside the sync.
- Seen: it listed the threads waiting on the team's answer, each with its owner session and the time the wait began,
  and reminded the owner of [#634](https://github.com/teamrig/teamrig/issues/634) at 12:57 IST, a comment waiting
  since 2026-11-22 18:57 IST.

## tracker.mentions

- Windows 11, gh 2.101.0, 2026-11-23.
- Ran: the mention scan inside the sync.
- Seen: a post naming one of the team's people on [#2034](https://github.com/teamrig/teamrig/pull/2034) woke that
  person's session at 12:44 IST, and the scan kept each comment it had read with its update time.

## codehost.pull-news

- Windows 11, gh 2.101.0, 2026-11-23.
- Ran: the pull request pass inside the sync.
- Seen: it kept each open pull request's merge, check and review state, such as
  [#2359](https://github.com/teamrig/teamrig/pull/2359) mergeable, checks pending, review required, minutes after it
  opened; a code-scanning review on [#2355](https://github.com/teamrig/teamrig/pull/2355) reached the owner session's
  inbox at 12:44 IST with its link.

## codehost.ci-excerpt

- Windows 11, gh 2.101.0, 2026-11-23.
- Ran: the failed CI read inside the sync.
- Seen: for [#2341](https://github.com/teamrig/teamrig/pull/2341) it wrote the end of the failed job "test
  (macos-latest, node 22)" from its "Run npm test" step, marked as data and never as instructions; for a job still
  running it wrote that the log is not readable yet.
