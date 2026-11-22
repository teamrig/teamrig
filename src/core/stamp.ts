import { KIT_NAME } from './home.ts';
import { KIT_VERSION } from './version.ts';

/**
 * The "made with teamrig" stamp (GeneralA6/teamrig#1102): credit on what teamrig writes, and a way for a reader to
 * find the project, as Claude Code's "Generated with" line does. This module is the one place its text is built;
 * every writer calls it rather than formatting its own, so the wording changes in one place.
 */

/** The project's home, the link of the footer; a test holds it to the plugin manifest's `repository`. */
export const STAMP_LINK = 'https://github.com/GeneralA6/teamrig';

/**
 * The hidden line that ends every footer. It is how a later write finds an earlier footer, whatever its version
 * or wording, so a rerun, a retry or an edit of a stamped text keeps one footer.
 */
export const STAMP_MARKER = '<!-- teamrig-stamp -->';

/**
 * What goes in front of the name in the footer: nothing until the logo lands (its own issue under #1104), then the
 * icon, 14 px high, with a space after it. The icon carries teamrig's palette in its own SVG, so the footer sets no
 * colour.
 */
export const STAMP_ICON = '';

/** The trailer key a commit teamrig makes carries; git matches trailer keys without case. */
export const STAMP_TRAILER_KEY = 'Made-with';

/** The Markdown footer: `<sub>Made with [teamrig](link) <version></sub>`, then the marker on its own line. */
export function stampFooter(version: string = KIT_VERSION): string {
  return `<sub>Made with ${STAMP_ICON}[${KIT_NAME}](${STAMP_LINK}) ${version}</sub>\n${STAMP_MARKER}`;
}

/** The footer's parts: the name a reader sees, where it links and the version after it. */
export interface StampCredit {
  readonly name: string;
  readonly link: string;
  readonly version: string;
}

/**
 * The footer's parts, for a tool whose text is not Markdown but a document format of its own: its writer builds the
 * link in the tool's own shape from these, so the wording still comes from this module. Such a footer has no marker
 * line.
 */
export function stampCredit(version: string = KIT_VERSION): StampCredit {
  return { name: KIT_NAME, link: STAMP_LINK, version };
}

/**
 * A footer the marker ends: the blank lines before it, the `<sub>` line above the marker when there is one (an older
 * footer may say another version or wording), and the marker line. Line ends may be `\r\n`, as in a body file saved
 * on Windows.
 */
const FOOTER = new RegExp(`(?:\\r?\\n)*(?:^<sub>[^\\r\\n]*</sub>[ \\t]*\\r?\\n)?^[ \\t]*${STAMP_MARKER}[ \\t]*(?:(?:\\r?\\n)+|$)`, 'gmu');

/** `body` with every footer the marker finds taken out; text after a footer stays, a paragraph apart from what was before it. */
export function withoutStampFooter(body: string): string {
  return body.replace(FOOTER, (match: string, at: number, whole: string) => (at === 0 || at + match.length === whole.length ? '' : '\n\n')).trimEnd();
}

/**
 * `body` with one footer at its end: any earlier footer is taken out first, so stamping a stamped text, or one edited
 * after it was posted, leaves a single footer at `version`.
 */
export function withStampFooter(body: string, version: string = KIT_VERSION): string {
  const bare = withoutStampFooter(body);
  return bare === '' ? stampFooter(version) : `${bare}\n\n${stampFooter(version)}`;
}

/** The commit trailer: `Made-with: teamrig <version>`. */
export function stampTrailer(version: string = KIT_VERSION): string {
  return `${STAMP_TRAILER_KEY}: ${KIT_NAME} ${version}`;
}

/** The trailer key naming the program, model and effort of the session that made a commit. */
export const MADE_BY_TRAILER_KEY = 'Made-by';

/** What a `Made-by` trailer writes for a part the host does not tell: never a guess. */
export const STAMP_UNKNOWN = 'unknown';

/**
 * Who made a commit: the host program's name, which every host tells, and its version, the session's model and its
 * effort level, each undefined when the host does not tell it.
 */
export interface StampMaker {
  readonly program: string;
  readonly version: string | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
}

/** The maker trailer: `Made-by: <program> <version>; model <model>; effort <effort>`, `unknown` for an untold part. */
export function madeByTrailer(maker: StampMaker): string {
  const told = (part: string | undefined): string => (part === undefined || part.trim() === '' ? STAMP_UNKNOWN : part.trim());
  return `${MADE_BY_TRAILER_KEY}: ${maker.program} ${told(maker.version)}; model ${told(maker.model)}; effort ${told(maker.effort)}`;
}

/** A trailer line (`Key: value`) or the indented continuation of one, as git reads a trailer block. */
const TRAILER_LINE = /^(?:[A-Za-z0-9][A-Za-z0-9-]*:\s|[ \t]+\S)/u;

/** A `Made-with:` or `Made-by:` line, in any case: the trailers a stamp writes, which a restamp drops first. */
const STAMP_TRAILER_LINE = new RegExp(`^(?:${STAMP_TRAILER_KEY}|${MADE_BY_TRAILER_KEY}):`, 'iu');

/** The scissors line of a verbose commit: git drops it and everything below it from the message. */
const SCISSORS_LINE = /^# -+ >8 -+$/u;

/**
 * `message` split where the part git keeps ends: at a verbose commit's scissors line, else before the comment lines
 * an edited message ends with, which git strips. A commit-msg hook sees both, and a trailer below them would be lost.
 * A tail of blank lines only is no tail.
 */
function splitKept(message: string): { readonly kept: string; readonly tail: string } {
  const lines = message.split('\n');
  const scissors = lines.findIndex((line) => SCISSORS_LINE.test(line));
  let end = scissors === -1 ? lines.length : scissors;
  while (end > 0 && /^(?:#|\s*$)/u.test(lines[end - 1] ?? '')) {
    end -= 1;
  }
  const tail = lines.slice(end).join('\n');
  return { kept: lines.slice(0, end).join('\n'), tail: tail.trim() === '' ? '' : tail };
}

/** `text` (no comment tail) with `trailers` in its trailer block, after the stamp trailers already there are dropped. */
function withTrailers(message: string, trailers: readonly string[]): string {
  const text = message.trimEnd();
  const split = text.lastIndexOf('\n\n');
  const head = split === -1 ? '' : text.slice(0, split);
  const last = split === -1 ? text : text.slice(split + 2);
  const lines = last.split('\n');
  // A subject alone is never a trailer block, even one shaped `fix: x`: git reads the first paragraph as the title.
  const isBlock = split !== -1 && lines.every((line) => TRAILER_LINE.test(line)) && !/^[ \t]/u.test(last);
  if (!isBlock) {
    return text === '' ? trailers.join('\n') : `${text}\n\n${trailers.join('\n')}`;
  }
  const kept = lines.filter((line) => !STAMP_TRAILER_LINE.test(line));
  return `${head}\n\n${[...kept, ...trailers].join('\n')}`;
}

/**
 * `message` with the stamp's trailers in git's trailer block, its last paragraph when every line of that is a
 * trailer, else a new last paragraph: `Made-with: teamrig <version>`, then `Made-by` when `maker` is given (a commit
 * a session made). The stamp trailers already in the block are dropped first, so a rerun or an amend keeps one of
 * each, with the values of the run that stamps last; a commit with no maker drops an old `Made-by`, as no session
 * made that version of it. A comment tail or a verbose commit's diff stays below the trailers, for git to strip.
 */
export function withStampTrailers(message: string, maker: StampMaker | undefined, version: string = KIT_VERSION): string {
  const { kept, tail } = splitKept(message);
  const trailers = maker === undefined ? [stampTrailer(version)] : [stampTrailer(version), madeByTrailer(maker)];
  const stamped = withTrailers(kept, trailers);
  return tail === '' ? stamped : `${stamped}\n${tail}`;
}

/** `message` with one `Made-with:` trailer and no `Made-by` (see `withStampTrailers`). */
export function withStampTrailer(message: string, version: string = KIT_VERSION): string {
  return withStampTrailers(message, undefined, version);
}
