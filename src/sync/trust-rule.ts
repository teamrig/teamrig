/**
 * A tracker's trust rule as the team's config writes it (T4928): which authors' issues may become tasks as written.
 * The core evaluates it, so every connector that reads one gives it the same meaning. Only `inside` adds trust; only
 * `never` and `edits` take it away; nothing reads trust from the issue's own text.
 */

/** One way to name authors. Each connector's config check refuses a kind it cannot read, never a silent no-op. */
export type TrustMatcher =
  /** Authors whose account is of one of these kinds, as the tracker names them (`atlassian`, `customer`, `app`). */
  | { readonly kind: 'accountType'; readonly types: readonly string[] }
  /** Authors by their account ids, which never change; a display name is never a matcher, anyone can copy one. */
  | { readonly kind: 'accounts'; readonly ids: readonly string[] };

/** `inside`: a title or body edit by an author who is not inside drops the issue's trust; `any`: edits keep it. */
export type TrustEdits = 'inside' | 'any';

/** A site's rule, or a project's override of it; a key left undefined takes the level above's. */
export interface TrustLevel {
  /** An author matching any of these is inside; undefined takes the default. */
  readonly inside: readonly TrustMatcher[] | undefined;
  /** An author matching any of these is never inside. A project's list adds to the site's, never replaces it (C6). */
  readonly never: readonly TrustMatcher[];
  readonly edits: TrustEdits | undefined;
}

/** A project's own rule: `import: false` reads nothing from it. */
export interface ProjectTrust extends TrustLevel {
  readonly import: boolean;
}

/** A connector's whole rule: the site's, and each project's override by its key. */
export interface SiteTrust extends TrustLevel {
  readonly projects: ReadonlyMap<string, ProjectTrust>;
}

/** The rule one project's issues are judged by, its levels already merged. */
export interface ResolvedTrust {
  readonly inside: readonly TrustMatcher[];
  readonly never: readonly TrustMatcher[];
  readonly edits: TrustEdits;
  /**
   * Set when the default `inside` was held back because anyone may browse the project (the public-project guard): it
   * names the key a team sets to let its people in.
   */
  readonly heldDefault: string | undefined;
}

/** The default a connector gives `inside` and `edits` when neither the site nor the project sets them. */
export interface TrustDefaults {
  readonly inside: readonly TrustMatcher[];
  readonly edits: TrustEdits;
}

/**
 * The rule of `project`, its overrides on top of the site's. `publicProject` is true unless the tracker proved the
 * project closed to anonymous readers: the default `inside` is then not applied, only one a team wrote. `insideKey` is
 * the config key the guard's line names.
 */
export function resolveTrust(site: SiteTrust, project: string, defaults: TrustDefaults, publicProject: boolean, insideKey: string): ResolvedTrust {
  const own = site.projects.get(project);
  const written = own?.inside ?? site.inside;
  const never = [...site.never, ...(own?.never ?? [])];
  const edits = own?.edits ?? site.edits ?? defaults.edits;
  if (written !== undefined) {
    return { inside: written, never, edits, heldDefault: undefined };
  }
  return publicProject ? { inside: [], never, edits, heldDefault: insideKey } : { inside: defaults.inside, never, edits, heldDefault: undefined };
}

/** Whether `project` is read at all. */
export function importsProject(site: SiteTrust, project: string): boolean {
  return site.projects.get(project)?.import ?? true;
}

/** An author as the tracker gives it; `accountType` undefined when the tracker did not say. */
export interface TrustAuthor {
  readonly accountId: string;
  readonly accountType: string | undefined;
}

/**
 * Who edited the issue's title or body: `read` when the tracker read its whole history, `unread` with why when it
 * could not (a failed, capped or truncated page): no decision is taken on part of it (C4).
 */
export type TrustEditors = { readonly kind: 'read'; readonly editors: readonly TrustAuthor[] } | { readonly kind: 'unread'; readonly why: string };

/** What the rule is judged on: the issue's author (undefined for none, or one the tracker hides) and its editors. */
export interface TrustFacts {
  readonly author: TrustAuthor | undefined;
  readonly editors: TrustEditors;
}

/**
 * The rule's answer and the block that gave it, for the preview line. `failed` is set when a fact could not be read:
 * the sync prints it as a FAILED line.
 */
export type TrustVerdict =
  | { readonly trusted: true; readonly why: string }
  | { readonly trusted: false; readonly why: string; readonly failed: string | undefined };

/** Whether `author` matches `matcher`; an author fact the tracker did not give never matches (fail closed). */
export function matches(matcher: TrustMatcher, author: TrustAuthor): boolean {
  if (matcher.kind === 'accounts') {
    return author.accountId !== '' && matcher.ids.includes(author.accountId);
  }
  return author.accountType !== undefined && matcher.types.includes(author.accountType);
}

/** How a matcher reads in a preview line: `accountType atlassian`, `accounts <id>`. */
export function matcherText(matcher: TrustMatcher): string {
  return matcher.kind === 'accounts' ? `accounts ${matcher.ids.join(',')}` : `accountType ${matcher.types.join(',')}`;
}

function isInside(rule: ResolvedTrust, author: TrustAuthor): boolean {
  return !rule.never.some((matcher) => matches(matcher, author)) && rule.inside.some((matcher) => matches(matcher, author));
}

function untrusted(why: string, failed?: string): TrustVerdict {
  return { trusted: false, why, failed };
}

/** Whether an issue with these facts may become a task as written under `rule`, and why. */
export function judgeTrust(rule: ResolvedTrust, facts: TrustFacts): TrustVerdict {
  const author = facts.author;
  if (author === undefined || author.accountId === '') {
    return untrusted('the reporter is anonymous or hidden');
  }
  const never = rule.never.find((matcher) => matches(matcher, author));
  if (never !== undefined) {
    return untrusted(`the reporter matches never (${matcherText(never)})`);
  }
  const inside = rule.inside.find((matcher) => matches(matcher, author));
  if (inside === undefined) {
    if (rule.heldDefault !== undefined) {
      return untrusted(`anyone may browse the project, so the default inside is not applied; set ${rule.heldDefault}`);
    }
    return untrusted(`the reporter (${author.accountType ?? 'unknown'} account) matches no inside`);
  }
  if (rule.edits === 'inside') {
    if (facts.editors.kind === 'unread') {
      return untrusted('its edit history could not be read whole', facts.editors.why);
    }
    const outsider = facts.editors.editors.find((editor) => !isInside(rule, editor));
    if (outsider !== undefined) {
      return untrusted(`its title or body was edited by ${outsider.accountId === '' ? 'an anonymous account' : outsider.accountId}, who is not inside`);
    }
  }
  return { trusted: true, why: `the reporter matches inside (${matcherText(inside)})` };
}
