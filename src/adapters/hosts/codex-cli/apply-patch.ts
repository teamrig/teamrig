/**
 * Codex CLI's `apply_patch` text, read into the file operations it asks for.
 *
 * Codex edits files with one tool, `apply_patch`, whose hook input carries the whole patch as `tool_input.command`, so
 * a guard on file writes learns which files a call touches only by reading that text. This reader follows Codex
 * 0.170.0's own parser line for line (`codex-rs/apply-patch/src/parser.rs` and `streaming_parser.rs`, tag
 * rust-v0.170.0), its leniencies included: the text is trimmed, a marker may carry spaces around it, and a
 * `<<EOF` wrapper is taken off. A guard may only pass a call it read the way Codex will, so a patch this reader
 * cannot read is refused with a reason, never passed, and a patch Codex would refuse is refused here too.
 *
 * It reads the text only: a path comes back as written, relative or absolute, and resolving it against the call's
 * working folder is the caller's job. A patch naming an environment id is applied by Codex in that environment, not
 * in the session's own folder; the id comes back so the caller decides.
 */

/** One file a patch touches. `addedLines` and `removedLines` are the `+` and `-` lines, without their sign. */
export type PatchOperation =
  | { readonly kind: 'add'; readonly path: string; readonly addedLines: readonly string[] }
  | { readonly kind: 'delete'; readonly path: string }
  | {
      readonly kind: 'update';
      readonly path: string;
      /** Where the file moves to, when the patch renames it. */
      readonly moveTo?: string;
      readonly addedLines: readonly string[];
      readonly removedLines: readonly string[];
    };

/** A patch read whole, or why it cannot be read. */
export type PatchReading =
  | { readonly ok: true; readonly operations: readonly PatchOperation[]; readonly environmentId?: string }
  | { readonly ok: false; readonly reason: string };

const BEGIN_PATCH = '*** Begin Patch';
const END_PATCH = '*** End Patch';
const ADD_FILE = '*** Add File: ';
const DELETE_FILE = '*** Delete File: ';
const UPDATE_FILE = '*** Update File: ';
const MOVE_TO = '*** Move to: ';
const END_OF_FILE = '*** End of File';
const ENVIRONMENT_ID = '*** Environment ID:';
const CONTEXT = '@@ ';
const EMPTY_CONTEXT = '@@';
const HEREDOC_OPENERS: ReadonlySet<string> = new Set(['<<EOF', "<<'EOF'", '<<"EOF"']);

const FIRST_LINE = `The first line of the patch must be '${BEGIN_PATCH}'`;
const LAST_LINE = `The last line of the patch must be '${END_PATCH}'`;
const NO_LINES = 'Update hunk does not contain any lines';

/**
 * The characters Rust's `str::trim` takes off (Unicode White_Space). JavaScript's `trim` differs: it leaves U+0085,
 * which Codex takes off a path's end, and takes off U+FEFF, which Codex keeps. A path read differently from Codex's
 * is a file a guard misses, so the trims here use Rust's set.
 */
const RUST_WHITE_SPACE: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/** A loop, not a regex: `\s+$` backtracks over each run of spaces, and the text is the model's to choose. */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && RUST_WHITE_SPACE.has(text.charCodeAt(end - 1))) {
    end -= 1;
  }
  return text.slice(0, end);
}

function trim(text: string): string {
  const ended = trimEnd(text);
  let start = 0;
  while (start < ended.length && RUST_WHITE_SPACE.has(ended.charCodeAt(start))) {
    start += 1;
  }
  return ended.slice(start);
}

function withoutCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

class UnreadablePatch extends Error {}

function invalidHunk(message: string, lineNumber: number): UnreadablePatch {
  return new UnreadablePatch(`invalid hunk at line ${lineNumber}, ${message}`);
}

function invalidPatch(message: string): UnreadablePatch {
  return new UnreadablePatch(`invalid patch: ${message}`);
}

function notAHeader(trimmed: string, lineNumber: number): UnreadablePatch {
  return invalidHunk(
    `'${trimmed}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
    lineNumber,
  );
}

function unexpectedLine(line: string, lineNumber: number): UnreadablePatch {
  return invalidHunk(
    `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
    lineNumber,
  );
}

function contextMarkerExpected(line: string, lineNumber: number): UnreadablePatch {
  return invalidHunk(`Expected update hunk to start with a @@ context marker, got: '${line}'`, lineNumber);
}

interface AddHunk {
  readonly kind: 'add';
  readonly path: string;
  readonly addedLines: string[];
}

interface DeleteHunk {
  readonly kind: 'delete';
  readonly path: string;
}

/** An update hunk as it is read: its chunks are counted, and the last one's state kept, for Codex's own refusals. */
interface UpdateHunk {
  readonly kind: 'update';
  readonly path: string;
  readonly lineNumber: number;
  moveTo: string | undefined;
  readonly addedLines: string[];
  readonly removedLines: string[];
  chunks: number;
  lastChunkLines: number;
  lastChunkEndsFile: boolean;
}

type Hunk = AddHunk | DeleteHunk | UpdateHunk;

/** Where the reader is in the patch; a hunk that takes more lines is carried with its mode. */
type Mode =
  | { readonly kind: 'not-started' | 'started' | 'delete' | 'ended' }
  | { readonly kind: 'add'; readonly hunk: AddHunk }
  | { readonly kind: 'update'; readonly hunk: UpdateHunk };

interface Reader {
  mode: Mode;
  readonly hunks: Hunk[];
  environmentId: string | undefined;
}

/** The patch's lines between its begin and end markers, both kept, a heredoc wrapper around them taken off. */
function patchLines(patch: string): readonly string[] {
  const trimmed = trim(patch);
  const lines = trimmed === '' ? [] : trimmed.split('\n').map(withoutCarriageReturn);
  const unbounded = boundaryFault(lines);
  if (unbounded === undefined) {
    return lines;
  }
  const first = lines[0];
  const last = lines.at(-1);
  if (lines.length < 4 || first === undefined || last === undefined || !HEREDOC_OPENERS.has(first) || !last.endsWith('EOF')) {
    throw invalidPatch(unbounded);
  }
  const inner = lines.slice(1, -1);
  const innerFault = boundaryFault(inner);
  if (innerFault !== undefined) {
    throw invalidPatch(innerFault);
  }
  return inner;
}

/**
 * What is wrong with the first or the last line; undefined when they are the two markers. With no line at all Codex
 * names the last line, not the first.
 */
function boundaryFault(lines: readonly string[]): string | undefined {
  const first = lines[0];
  const last = lines.at(-1);
  if (first === undefined || last === undefined) {
    return LAST_LINE;
  }
  if (trim(first) !== BEGIN_PATCH) {
    return FIRST_LINE;
  }
  return trim(last) === END_PATCH ? undefined : LAST_LINE;
}

/**
 * Codex refuses an update hunk with no chunk, and a chunk with no line, when the next header or the end closes it.
 * Codex looks at the last hunk whatever its mode; the open one is enough here, as an update hunk that is last and no
 * longer open was closed by an end marker, which made this same check.
 */
function closeUpdateHunk(reader: Reader, closingLine: string, lineNumber: number): void {
  if (reader.mode.kind !== 'update') {
    return;
  }
  const { hunk } = reader.mode;
  if (hunk.chunks === 0) {
    throw invalidHunk(`Update file hunk for path '${hunk.path}' is empty`, hunk.lineNumber);
  }
  if (hunk.lastChunkLines === 0) {
    throw closingLine === END_PATCH ? invalidHunk(NO_LINES, lineNumber) : unexpectedLine(closingLine, lineNumber);
  }
}

/** Takes a line that is the environment id, the end marker or a hunk header; false when it is none of them. */
function takeHeader(reader: Reader, text: string, lineNumber: number): boolean {
  if (reader.mode.kind === 'started' && text.startsWith(ENVIRONMENT_ID)) {
    if (reader.environmentId !== undefined) {
      throw invalidPatch('apply_patch environment_id cannot be specified more than once');
    }
    const environmentId = trim(text.slice(ENVIRONMENT_ID.length));
    if (environmentId === '') {
      throw invalidPatch('apply_patch environment_id cannot be empty');
    }
    reader.environmentId = environmentId;
    return true;
  }
  if (text === END_PATCH) {
    closeUpdateHunk(reader, text, lineNumber);
    reader.mode = { kind: 'ended' };
    return true;
  }
  if (text.startsWith(ADD_FILE)) {
    closeUpdateHunk(reader, text, lineNumber);
    const hunk: AddHunk = { kind: 'add', path: text.slice(ADD_FILE.length), addedLines: [] };
    reader.hunks.push(hunk);
    reader.mode = { kind: 'add', hunk };
    return true;
  }
  if (text.startsWith(DELETE_FILE)) {
    closeUpdateHunk(reader, text, lineNumber);
    reader.hunks.push({ kind: 'delete', path: text.slice(DELETE_FILE.length) });
    reader.mode = { kind: 'delete' };
    return true;
  }
  if (text.startsWith(UPDATE_FILE)) {
    closeUpdateHunk(reader, text, lineNumber);
    const hunk: UpdateHunk = {
      kind: 'update',
      path: text.slice(UPDATE_FILE.length),
      lineNumber,
      moveTo: undefined,
      addedLines: [],
      removedLines: [],
      chunks: 0,
      lastChunkLines: 0,
      lastChunkEndsFile: false,
    };
    reader.hunks.push(hunk);
    reader.mode = { kind: 'update', hunk };
    return true;
  }
  return false;
}

function openChunk(hunk: UpdateHunk): void {
  hunk.chunks += 1;
  hunk.lastChunkLines = 0;
  hunk.lastChunkEndsFile = false;
}

/** A context, added or removed line: it opens the hunk's first chunk when no `@@` line did. */
function countChunkLine(hunk: UpdateHunk): void {
  if (hunk.chunks === 0) {
    openChunk(hunk);
  }
  hunk.lastChunkLines += 1;
}

/** One line of an update hunk that is no header. A marker counts only at the line's start: indented, it is context. */
function readUpdateLine(hunk: UpdateHunk, line: string, lineNumber: number): void {
  const updateLine = trimEnd(line);
  const contextMarker = updateLine === EMPTY_CONTEXT || updateLine.startsWith(CONTEXT);
  if (hunk.chunks > 0 && hunk.lastChunkEndsFile) {
    if (updateLine === '') {
      return;
    }
    if (!contextMarker) {
      throw contextMarkerExpected(line, lineNumber);
    }
  }
  if (hunk.chunks === 0 && hunk.moveTo === undefined && updateLine.startsWith(MOVE_TO)) {
    hunk.moveTo = updateLine.slice(MOVE_TO.length);
    return;
  }
  const lastChunkEmpty = hunk.chunks > 0 && hunk.lastChunkLines === 0;
  if (contextMarker) {
    if (lastChunkEmpty) {
      throw unexpectedLine(line, lineNumber);
    }
    openChunk(hunk);
    return;
  }
  if (updateLine === END_OF_FILE) {
    if (lastChunkEmpty) {
      throw invalidHunk(NO_LINES, lineNumber);
    }
    hunk.lastChunkEndsFile = hunk.chunks > 0;
    return;
  }
  if (line === '' || line.startsWith(' ')) {
    countChunkLine(hunk);
    return;
  }
  if (line.startsWith('+')) {
    countChunkLine(hunk);
    hunk.addedLines.push(line.slice(1));
    return;
  }
  if (line.startsWith('-')) {
    countChunkLine(hunk);
    hunk.removedLines.push(line.slice(1));
    return;
  }
  throw hunk.chunks > 0 && hunk.lastChunkLines > 0 ? contextMarkerExpected(line, lineNumber) : unexpectedLine(line, lineNumber);
}

function readLine(reader: Reader, line: string, lineNumber: number): void {
  const trimmed = trim(line);
  const { mode } = reader;
  if (mode.kind === 'not-started') {
    // patchLines held that the first line is the begin marker, so only that line is read here.
    reader.mode = { kind: 'started' };
    return;
  }
  if (mode.kind === 'ended') {
    if (trimmed !== '') {
      throw invalidPatch(LAST_LINE);
    }
    return;
  }
  if (mode.kind === 'update') {
    if (!takeHeader(reader, trimEnd(line), lineNumber)) {
      readUpdateLine(mode.hunk, line, lineNumber);
    }
    return;
  }
  if (takeHeader(reader, trimmed, lineNumber)) {
    return;
  }
  if (mode.kind === 'add' && line.startsWith('+')) {
    mode.hunk.addedLines.push(line.slice(1));
    return;
  }
  throw notAHeader(trimmed, lineNumber);
}

function operationOf(hunk: Hunk): PatchOperation {
  if (hunk.kind !== 'update') {
    return hunk;
  }
  const { path, addedLines, removedLines, moveTo } = hunk;
  return { kind: 'update', path, addedLines, removedLines, ...(moveTo === undefined ? {} : { moveTo }) };
}

/** The file operations of an `apply_patch` call's patch text, or why Codex would not read it either. */
export function readApplyPatch(patch: string): PatchReading {
  const reader: Reader = { mode: { kind: 'not-started' }, hunks: [], environmentId: undefined };
  try {
    const lines = patchLines(patch);
    // Codex strips a second carriage return from every line it reads before the last. The last it reads apart: it is
    // the end marker, as patchLines held, whatever hunk is open.
    lines.slice(0, -1).forEach((line, index) => readLine(reader, withoutCarriageReturn(line), index + 1));
    closeUpdateHunk(reader, END_PATCH, lines.length);
  } catch (error) {
    if (error instanceof UnreadablePatch) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
  const operations = reader.hunks.map(operationOf);
  return reader.environmentId === undefined ? { ok: true, operations } : { ok: true, operations, environmentId: reader.environmentId };
}
