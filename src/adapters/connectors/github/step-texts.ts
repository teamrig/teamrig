import type { StepTexts } from '../../../features/steps.ts';

/** How GitHub does the steps its declaration lists, printed by `teamrig skills step <id>`. */
export const stepTexts: StepTexts<'connector'> = {
  'tracker.link-child':
    'On GitHub a child issue is a sub-issue of its parent. On the parent issue, choose "Create sub-issue", then "Add existing issue", and pick the child. From a shell, `gh api repos/<owner>/<name>/issues/<parent number>/sub_issues -X POST -F sub_issue_id=<child id>` adds it: the child\'s id is its `id` field (`gh api repos/<owner>/<name>/issues/<child number> --jq .id`), not its number. `teamrig issue links` puts the whole task tree on the issues this way.',
  'codehost.private-report':
    'On GitHub, open the repository\'s Security tab and choose "Report a vulnerability": it opens a draft security advisory only the maintainers see. That button shows only where the repository turned on private vulnerability reporting; where it is missing, follow the repository\'s SECURITY.md, never a public issue, discussion or comment.',
  'codehost.fetch-outside-change':
    'On GitHub every pull request\'s head is readable from the base repository, a fork\'s included: `git fetch origin pull/<number>/head:review-<number>` puts it on a local branch, which you read with `git log` and `git diff` against the base branch. Run none of its code, scripts or install steps while you review it.',
};
