/**
 * The Stop-hook lint of core rule 11 on a reply (T2313): a step the human runs by hand reaches them only as an
 * audited file, its sha256 pinned, run by one line. A reply that hands the human a fenced shell or JSON block, or a
 * PowerShell call line (`& '...'`), with no sha256 beside it breaks it; the decision card (T2312) is the other route,
 * refused at `set`. Measured on a week of replies (tasks/T2313/measure.md): in team sessions 16 of 17 flags were real
 * hand steps (deletes, pushes, installs, settings pastes), about 2.4 a day, so the lint blocks rather than nudges.
 */

/** A shape of hand step a reply holds. */
export type HandStepShape = 'shell' | 'json' | 'call';

/** The fence languages a human runs in a shell. */
const SHELL_LANGS: ReadonlySet<string> = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'powershell', 'ps1', 'pwsh', 'ps', 'cmd', 'bat', 'batch']);
/** The fence languages a human pastes into a settings or config file. */
const JSON_LANGS: ReadonlySet<string> = new Set(['json', 'jsonc', 'json5']);
/** A fenced block: its language word and its body. */
const FENCE = /^ {0,3}```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)^ {0,3}```/gmu;
/** PowerShell's call operator on a script path at a line's start: the run line of a `.ps1` hand step. */
const CALL_LINE = /^[ \t]*&[ \t]+['"]/gmu;
/**
 * A pinned sha256: a whole one, or `sha256` followed within 20 characters by 8 or more hex, which the card's run line
 * holds (`run: & '<path>'   (sha256 <8 hex>, audited by <session>)`). A bare backticked 8-hex does not pin: any short
 * commit id would pass.
 */
const PINNED = /\b[0-9a-f]{64}\b|sha256[^\n]{0,20}\b[0-9a-f]{8,}\b/iu;
/** The word a reply writes before a block that only reads (changes nothing, touches no secret), which the lint lets by. */
const READ_ONLY = /\bread-only\b/iu;
/**
 * The past-tense verbs a lead-in uses for what a tool call or command already gave back ("call 2 returned:", "it
 * printed:"), which make the block after it a quote of that result, not a step to run (T5359). A Codex CLI turn has
 * no transcript teamrig reads, so the reply's own words are all the lint sees, and a reply asked to report what a
 * call returned quotes its JSON in a fence. Nouns such as "output" or "results" are no marker: "the output changes
 * once you apply:" hands a step over.
 */
const QUOTED_RESULT = /\b(?:returned|printed|came back|answered|replied|responded)\b/iu;
/** A lead-in quotes a result only when it ends on a colon, as "call 2 returned:" does (markdown emphasis after it). */
const ENDS_ON_COLON = /:[*_]*\s*$/u;
/** Words that turn a lead-in to what is still to come or to what the human does, so it quotes nothing. */
const NOT_A_QUOTE = /\b(?:will|once|after|you)\b/iu;
/** The words a lead-in or the block's own line uses to hand a block to the human, which no quoting word overrules. */
const HANDS_OVER =
  /\b(?:run|paste|add|put|set|write|copy|type|replace|save|insert|append|edit|enter|execute|apply|use|try|changes?)\b/iu;

/** The last line of `text` before `index` that holds more than blanks, and the line `index` starts on. */
function linesAround(text: string, index: number): { readonly before: string; readonly own: string } {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = text.indexOf('\n', index);
  const own = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const before = text.slice(0, lineStart).split('\n').reverse().find((line) => line.trim() !== '') ?? '';
  return { before, own };
}

/** Whether the lead-in `before` quotes what a call already returned and neither it nor `own` hands anything over. */
function quotesAResult(before: string, own: string): boolean {
  return (
    ENDS_ON_COLON.test(before) &&
    QUOTED_RESULT.test(before) &&
    !NOT_A_QUOTE.test(before) &&
    !HANDS_OVER.test(before) &&
    !HANDS_OVER.test(own)
  );
}

/**
 * Whether the reply marked the block or line at `index` as no step to run: read-only on the line before it or its
 * own line, or a lead-in quoting what a call returned that hands nothing over.
 */
function markedNotToRun(text: string, index: number): boolean {
  const { before, own } = linesAround(text, index);
  return READ_ONLY.test(before) || READ_ONLY.test(own) || quotesAResult(before, own);
}

/** The shape of a fenced block of language `lang`, or undefined for code the human does not run (TypeScript, a log). */
function fenceShapeOf(lang: string, body: string): HandStepShape | undefined {
  if (SHELL_LANGS.has(lang)) {
    return 'shell';
  }
  if (JSON_LANGS.has(lang)) {
    return 'json';
  }
  return lang === '' && new RegExp(CALL_LINE.source, 'mu').test(body) ? 'call' : undefined;
}

/**
 * The hand step shapes a reply holds that are not marked as no step to run, each once, in the order they first appear:
 * shell and JSON fences, a fence with no language holding a call line, and a call line outside any fence.
 */
export function handStepsOf(text: string): readonly HandStepShape[] {
  const found: { readonly shape: HandStepShape; readonly at: number }[] = [];
  for (const match of text.matchAll(FENCE)) {
    const shape = fenceShapeOf((match[1] ?? '').toLowerCase(), match[2] ?? '');
    if (shape !== undefined && !markedNotToRun(text, match.index)) {
      found.push({ shape, at: match.index });
    }
  }
  // The fences blanked out, newlines kept, so a call line is found only outside them, at its place in the reply.
  const outside = text.replace(FENCE, (fence) => fence.replace(/[^\n]/gu, ' '));
  for (const match of outside.matchAll(CALL_LINE)) {
    if (!markedNotToRun(text, match.index)) {
      found.push({ shape: 'call', at: match.index });
    }
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((step) => step.shape))];
}

/** Each shape as the reason names it. */
const SHAPE_WORDS: Readonly<Record<HandStepShape, string>> = {
  shell: 'a shell block',
  json: 'a JSON block',
  call: "a PowerShell call line (& '...')",
};

/**
 * The instruction for a session whose reply hands the human a hand step with no pinned sha256; undefined when the
 * reply holds none, or carries a sha256 (an audited file's run line). `command` is the kit's CLI name.
 */
export function handStepLintReason(text: string, command: string): string | undefined {
  const shapes = handStepsOf(text);
  if (shapes.length === 0 || PINNED.test(text)) {
    return undefined;
  }
  const what = shapes.map((shape) => SHAPE_WORDS[shape]).join(', ');
  return (
    `${command}: your reply handed the human ${what} with no pinned sha256. Core rule 11: a step the human runs by` +
    ' hand that changes anything or touches a secret reaches them only as a file the security reviewer audited, run by' +
    ' one line with its sha256 (skill hand-step). If it is such a step, tell the human now not to run it from chat,' +
    ' and hand it as an audited file. If it only reads (changes nothing, touches no secret), say so in one line;' +
    ' write read-only, or what a quoted block is the result of ("call 2 returned:"), on the line before such a block' +
    ' next time.'
  );
}
