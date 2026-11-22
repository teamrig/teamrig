---
name: dev-ship-release
description: Merge the teamrig release pull request like any pull request, on the lead's approval of a release task at its head, through ship.ts merge --release.
---

# Ship a release

The `release` workflow (`.github/workflows/release.yml`) keeps one release pull request open through release-please:
it raises the version in `plugins/teamrig/.claude-plugin/plugin.json` and `src/core/version.ts` and adds the notes to
`CHANGELOG.md`. `tools/ship/repos.json` names its branch and changelog under the repository's `release` key.
teamrig-pane's release pull request (its own release-please, component `teamrig-pane`) merges the same way, with the
pane's main checkout as `<repo dir>`: it raises the pane's plugin manifest and its release-please manifest, and the
release check reads any `plugins/<name>/.claude-plugin/plugin.json` as a version file (T4821).

Once the `teamrig-release` App is set up (variable `RELEASE_APP_ID`, its key in environment `release-merge`), the
`release merge` workflow (`release-merge.yml`) merges the release itself when ci passed on its head, and comments the head, paths
and checks it passed. The steps below are for a head its gate refused (its run's summary says why) or a repository
without the App: read that summary first, and fix the cause before approving.

1. Add a release task for the session that ships releases, saying which version it ships, and read the pull
   request's head: `git fetch origin` and `git rev-parse origin/<release head>`, the head `repos.json` names.
2. Wait until every required check passed on that head, then set the task waiting on the lead's approval, naming the
   head's sha: `teamrig set T<id> --status waiting --waits approval:<lead> --note "release <version> at <sha>"`.
3. Once approved, from the session that owns the task, queue the merge as a ship run:
   `node tools/ship/ship.ts merge <repo dir> --release T<id> --approved <sha>`. It reads the head from origin, refuses
   it before its gate when it changes anything but the version raises and the changelog's new notes (naming
   the path, `tools/ship/release-pull.ts`), proves its checks as the repository's gate does, and rebase-merges it.
   Written as `teamrig queue --kind merge --detach --session <you> --what "..." --task T<id> -- node <abs shipTool>
   merge <abs main checkout> --release T<id> --approved <full sha>`, it is a ship role call the route allow lets run
   with no permission prompt (T4672); any other shape goes to the permission check.
4. The next run of the release workflow tags main and publishes the plugin to the `preview` branch: check that the
   new tag and release exist before you set the task done. Stable takes it at its next daily move
   (`release-promote.yml`); a hotfix goes at once when you approve its preview tag and sha and the workflow runs by
   hand with both.

## Traps

- `--release` takes no `--head` and no `--note-file`: the branch is the one `repos.json` names, and the merge never
  opens the pull request. With none open it refuses: the release workflow opens it on its next run.
- Main moved past the head: release-please rewrites the head only when main gained a commit its changelog shows. When
  every commit main gained is a hidden type (`docs`, `style`, `chore`, `refactor`, `test`, `build`, `ci`) with no `!`,
  no `BREAKING CHANGE` or `Release-As` footer and no edit of release-please's config or manifest, the merge rebases
  the head onto main itself, pushes it to the same branch with a lease on the approved sha, and merges it on the same
  approval once its checks pass (T5055). When release-please wrote the head again on a newer main, the merge keeps the
  approval of the head `--approved` names as long as both heads hold only a release, and prints both (T5117): keep
  `--approved` at the approved sha and wait for the new head's checks. The repo dir must be clean for the rebase.
- A hand edit on the release branch (a fixed note, a stray file) is refused like any other path; release-please
  writes the head again on the next push to main, dropping the edit.
- The approval clears only the task's owner, from its own tab, at the approved sha; a merge from another session is
  refused as for any branch.

Last verified: 2026-11-22
