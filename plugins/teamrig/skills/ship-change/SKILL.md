---
name: ship-change
description: Use when landing a change through its own branch and change request, from the first commit to the merge, or pushing back a rebase or conflict fix.
---

# Land a change: one branch, one change request

A change lands through its own branch and one change request on the code host, reviewed and merged there. Each
step below holds for any repository and any code host; where the repository says more (its contributing guide, its
template, its own skills), it wins.

## 1. A branch of its own

- One change, one branch, cut from the newest default branch, in the session's own worktree:
  `teamrig worktree add --task <id>` fetches, names the branch after the task and runs the repository's setup
  ([teamrig worktree add](../teamrig-guide/commands.md#teamrig-worktree-add)). Never edit in a repository's main
  checkout, and never commit on the default branch.
- Name it by the repository's rule; with none, `<type>/<task id>-<slug>`, such as `fix/t12-parse-input`.

## 2. Small commits, each with its proof

- One logical change per commit: a fix with its tests, a refactor apart from what it enables, a mechanical change
  alone. Commit as each step passes, so a review or a revert takes one step.
- A new behaviour gets a test that fails without it, a bug fix one that fails on the old code. Prove the old code
  fails by reading it at the base (`git show origin/<default>:<path>`), not by stashing your work.
- Follow the repository's message rule (a Conventional subject, a sign-off) and its size rule; its hooks check them
  at the commit, so never skip them.

## 3. A description the reviewer can judge alone

The reviewer sees only the change request. Write its text in a file first, read it whole, then open the request.

- Use the repository's own template when it has one (the code host's template file, else what its contributing
  guide asks), keeping every section, filled or marked "none".
- With no template, give these: what changes and why; its reach (who it touches: every user, one team, only the
  repository's own tooling); how it was tested, naming the test that fails on the old code; the risks and how each is
  held; the alternatives weighed when it settles a design question; and the issue it closes or refers to, by the code
  host's own link words.
- Nothing private: no home paths, e-mail addresses, host names, internal ids, logs or secrets. A public repository's
  security fix names the hardening, never how to get past the old code ([security skill](../security/SKILL.md)).

## 4. One merge flow

- Where the code host merges by a queue with auto-merge, turn auto-merge on when you open the request. The reviewer's
  approval is then the only human step: the queue catches the branch up, runs the checks and merges. Nobody updates
  the branch by hand meanwhile, which only restarts its checks.
- Where the repository merges without a change request, merge the branch with `teamrig merge`
  ([teamrig merge](../teamrig-guide/commands.md#teamrig-merge)): checked, pushed under the host lock and recorded.
- Follow the request so its reviews, checks and merge reach you (`teamrig follow <ref>`), and answer each review
  comment on its thread with what changed (`teamrig issue reply <ref>`).
- Push and post with the key teamrig holds for that repository, never a login shared by the whole machine. A push
  or merge refused by a guard waits on the approval it names; never route around it with another branch, key or
  command.

## 5. A rebase or conflict fix goes back to the same branch

When the default branch moved and the change no longer merges cleanly:

1. `teamrig pr conflicts <ref>` names the files it conflicts on
   ([teamrig pr conflicts](../teamrig-guide/commands.md#teamrig-pr-conflicts)).
2. In the change's own worktree: `git fetch origin`, then `git rebase origin/<default>`; settle each stop and
   `git rebase --continue` (or `--abort` to start over). Rerun the tests.
3. `git push --force-with-lease`: the same branch, so the same change request takes the new commits and keeps its
   review thread. The lease refuses the push if someone else pushed to the branch meanwhile; fetch and look first.

Never a new branch or a second change request for the same change: a copy splits the review and leaves a dead
request behind. Close any copy that already exists, saying which request it duplicates. A protected branch (the
default branch, a release branch) is never rebased or force-pushed.
