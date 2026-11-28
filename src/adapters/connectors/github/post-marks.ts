import { isInsideAuthor, isOurAuthor, type IssueComment, type PostMark, type PostMarks } from '../../../plugin-api/index.ts';

/** An app's or a workflow's account kind on GitHub: its posts are no one's answer and no one's ask. */
const BOT = 'Bot';

/**
 * GitHub's marking of a post for the response clock (feature `tracker.clocks`). A bot's is none. With `github.owners`
 * naming the team's people, only their logins and the repository's owner answer (isOurAuthor): an outside
 * contributor given collaborator access still waits on us, and their follow-up is no answer (T3380). A team that
 * named no one falls back to the author's tie to the repository (isInsideAuthor).
 */
export function markGithubPost(post: IssueComment, team: ReadonlySet<string>): PostMark {
  if (post.authorKind === BOT) {
    return 'none';
  }
  const ours = team.size === 0 ? isInsideAuthor(post.authorAssociation) : isOurAuthor(post.authorAssociation, post.login, team);
  return ours ? 'ours' : 'theirs';
}

/** GitHub's post marks, as its tracker gives them. */
export const githubPostMarks: PostMarks = { markPost: markGithubPost };
