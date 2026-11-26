/**
 * The skills folder of a host that loads no plugin's skills: teamrig's skills are copied into a folder of the
 * person's that the host reads in every project, one teamrig alone writes. The core reads, copies and backs up the
 * files; this port only says where the folder is and what the person does after a write.
 */
export interface HostPluginSkills {
  /** The name a person picks this host by, as `setup skills --host` takes it. */
  readonly host: string;
  /**
   * The folder teamrig's skills go in for the person whose home folder is `userHome`, each skill below it as the
   * plugin ships it (`<folder>/<skill>/SKILL.md`). It holds teamrig's files only: a copy replaces all it holds.
   */
  folder(userHome: string): string;
  /** What the person must do after a write before the host reads the new skills, one line each. */
  readonly afterWrite: readonly string[];
}
