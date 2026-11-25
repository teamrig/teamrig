/**
 * The reach a pull request's note names, checked before the ship tool opens the pull request (T3417, #1402):
 * CONTRIBUTING.md asks every pull request for its reach, and nothing held it, so a change kept for teamrig's own
 * development never said why users do not need it. The note states one of four reaches, and a development-only change
 * of this repository's tooling names the issue that carries it to every user, or why none does.
 */

/** Who a change reaches: every user (the plugin), outside contributors, teamrig's maintainers alone, or one team. */
export type Reach = 'plugin' | 'contributors' | 'dev-only' | 'team';

/** The four values as a refusal names them, so the fix is in the message. */
export const REACH_VALUES = 'plugin | contributors | dev-only (<why users do not need it>) | team';

/** The two forms of a plugin carrier line. */
export const CARRIER_FORMS = '"Plugin carrier: #<n>" (the issue that brings it to every user) or "Plugin carrier: none: <why no user needs it>"';

/** A note's reach, or why it states none a reviewer can act on. */
export type ReachParse = { readonly kind: 'reach'; readonly reach: Reach } | { readonly kind: 'refused'; readonly why: string };

/** The paths whose development-only change names its plugin carrier: the repository's tooling and its dev skills. */
export function carriesToUsers(file: string): boolean {
  return file.startsWith('tools/') || file.startsWith('.claude/skills/dev-');
}

/** The text after a `Reach:` line, or the first line of a `## Reach` section; null when the note has neither. */
export function reachValueOf(note: string): string | null {
  const lines = note.split(/\r?\n/).map(line => line.trim());
  for (const [index, line] of lines.entries()) {
    const inline = /^Reach:(.*)$/.exec(line);
    if (inline !== null) return (inline[1] ?? '').trim();
    if (/^##\s+Reach$/.test(line)) return sectionValueOf(lines.slice(index + 1));
  }
  return null;
}

/** A section's first line that is neither blank nor a template comment, or '' when the section holds none. */
function sectionValueOf(lines: readonly string[]): string {
  for (const line of lines) {
    if (line.startsWith('## ')) return '';
    if (line === '' || /^<!--.*-->$/.test(line)) continue;
    return line;
  }
  return '';
}

/** One stated value read as a reach: a known word, and for dev-only its reason in parentheses, never empty. */
export function parseReach(value: string): ReachParse {
  if (value.startsWith('dev-only')) {
    const reason = /^dev-only\s*\(([^)]*)\)/.exec(value)?.[1]?.trim() ?? '';
    return reason === ''
      ? { kind: 'refused', why: 'its Reach is dev-only with no reason: write "dev-only (<why users do not need it>)"' }
      : { kind: 'reach', reach: 'dev-only' };
  }
  const known = /^(plugin|contributors|team)(?=$|[\s:,;.(])/.exec(value)?.[1];
  if (known === 'plugin' || known === 'contributors' || known === 'team') return { kind: 'reach', reach: known };
  return { kind: 'refused', why: `its Reach "${value}" is none of ${REACH_VALUES}` };
}

/** Whether the note names a plugin carrier in one of its two forms: an issue number, or none with its reason. */
export function hasCarrier(note: string): boolean {
  const lines = note.split(/\r?\n/).map(line => line.trim());
  const value = lines.map(line => /^Plugin carrier:(.*)$/.exec(line)?.[1]?.trim()).find(found => found !== undefined);
  return value !== undefined && (/^#\d+\b/.test(value) || /^none:\s*\S/.test(value));
}

/**
 * Why the note cannot open the pull request of a change to these files, or null when it may: a Reach of the four
 * values, and a development-only change of the tooling also its plugin carrier.
 */
export function reachRefusal(note: string, files: readonly string[]): string | null {
  const value = reachValueOf(note);
  if (value === null || value === '') return `the pull request note states no reach: start it with "Reach: ${REACH_VALUES}"`;
  const parsed = parseReach(value);
  if (parsed.kind === 'refused') return `the pull request note cannot open the pull request: ${parsed.why}`;
  if (parsed.reach !== 'dev-only') return null;
  const tooling = files.find(carriesToUsers);
  if (tooling === undefined || hasCarrier(note)) return null;
  return `the pull request note is dev-only and the change touches ${tooling}, but it names no plugin carrier: add ${CARRIER_FORMS}`;
}

/**
 * The reach refusal of a repo whose template asks for a `## Reach` section (its profile's pullSections), or null when
 * it asks for none or there is no note: a missing note is already refused as lacking the section (missingSections).
 * The changed files are read only when the check runs, so a repo that asks for no reach runs no diff.
 */
export function reachGate(note: string | null, sections: readonly string[], files: () => readonly string[]): string | null {
  if (note === null || !sections.includes('Reach')) return null;
  return reachRefusal(note, files());
}
