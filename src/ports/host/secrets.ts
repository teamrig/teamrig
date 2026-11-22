/**
 * The host's own secret files: what the secret guard keeps from every session, whatever host runs it. A port of its
 * own, apart from the host's paths, so an adapter that knows its secret files but none of its other folders still
 * names them, and one that names none says so with its reason.
 */
export interface HostSecrets {
  /**
   * The host's own files whose content is a secret, such as its login and what a person typed into it: globs as the
   * secret guard reads its list (`secretGuard.paths`), in which `~/` starts at the person's home folder and a glob
   * with no leading `/` or drive matches at any depth. The guard reads them after its own defaults and before a
   * team's globs, so a team's `!glob` still keeps one of them readable. A host only adds secret files: the guard
   * keeps every shipped host's whatever host runs, and leaves out a `!glob` named here.
   */
  secretFiles(): readonly string[];
}
