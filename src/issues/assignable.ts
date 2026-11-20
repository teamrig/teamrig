import type { Assignees } from './host.ts';

/** Which of some logins a repository may assign: each that may, as the host spells it, and each that may not. */
export type AssignableRead =
  | { readonly kind: 'read'; readonly spelled: ReadonlyMap<string, string>; readonly unassignable: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Reads once each whether `logins` may be assigned in `repo`, stopping at the first failed read. An assign goes out
 * only for a login that may, as the host spells it: GitHub silently drops an assign of a login that may not, or one in
 * another case than its own, so it would be sent again on every run.
 */
export async function readAssignable(host: Assignees, repo: string, logins: Iterable<string>): Promise<AssignableRead> {
  const spelled = new Map<string, string>();
  const unassignable: string[] = [];
  for (const login of new Set(logins)) {
    const found = await host.assigneeExists(repo, login);
    if (found.kind === 'failed') {
      return { kind: 'failed', reason: found.reason };
    }
    if (found.kind === 'missing') {
      unassignable.push(login);
    } else {
      spelled.set(login, found.login);
    }
  }
  return { kind: 'read', spelled, unassignable };
}

/** The logins of `logins` the repository may assign, each as the host spells it, in their order. */
export function assignableOf(logins: readonly string[], read: { readonly spelled: ReadonlyMap<string, string> }): string[] {
  return logins.flatMap((login) => {
    const spelled = read.spelled.get(login);
    return spelled === undefined ? [] : [spelled];
  });
}
