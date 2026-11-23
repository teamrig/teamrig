import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readApplyPatch } from './apply-patch.ts';
import type { PatchOperation } from './apply-patch.ts';

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const FIRST_LINE = "invalid patch: The first line of the patch must be '*** Begin Patch'";
const LAST_LINE = "invalid patch: The last line of the patch must be '*** End Patch'";
const NO_LINES = 'Update hunk does not contain any lines';

/** A patch of these lines between the two markers. */
function patchOf(...lines: readonly string[]): string {
  return [BEGIN, ...lines, END].join('\n');
}

function invalidHunk(lineNumber: number, message: string): string {
  return `invalid hunk at line ${lineNumber}, ${message}`;
}

function notAHeader(lineNumber: number, text: string): string {
  return invalidHunk(
    lineNumber,
    `'${text}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
  );
}

function unexpectedLine(lineNumber: number, line: string): string {
  return invalidHunk(
    lineNumber,
    `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
  );
}

function contextMarkerExpected(lineNumber: number, line: string): string {
  return invalidHunk(lineNumber, `Expected update hunk to start with a @@ context marker, got: '${line}'`);
}

function assertReads(patch: string, operations: readonly PatchOperation[]): void {
  assert.deepEqual(readApplyPatch(patch), { ok: true, operations });
}

function assertRefuses(patch: string, reason: string): void {
  assert.deepEqual(readApplyPatch(patch), { ok: false, reason });
}

const FILE2_PATCH = patchOf('*** Update File: file2.py', ' import foo', '+bar');
const FILE2_OPERATIONS: readonly PatchOperation[] = [
  { kind: 'update', path: 'file2.py', addedLines: ['bar'], removedLines: [] },
];

describe('readApplyPatch, the two markers', () => {
  it('refuses a text that does not begin with the begin marker', () => {
    assertRefuses('bad', FIRST_LINE);
    assertRefuses(`bad\n${END}`, FIRST_LINE);
    assertRefuses(END, FIRST_LINE);
  });

  it('refuses a text that does not end with the end marker', () => {
    assertRefuses(`${BEGIN}\nbad`, LAST_LINE);
    assertRefuses(BEGIN, LAST_LINE);
  });

  it('refuses a text with no line, naming the last line as Codex does', () => {
    assertRefuses('', LAST_LINE);
    assertRefuses(' \r\n\t\n', LAST_LINE);
  });

  it('reads the two markers alone as no operation', () => {
    assertReads(`${BEGIN}\n${END}`, []);
    assertReads(`\n\n  ${BEGIN}\n${END}  \n\n`, []);
  });

  it('takes spaces around a marker', () => {
    assertReads(`${BEGIN} \n*** Add File: foo\n+hi\n ${END}`, [{ kind: 'add', path: 'foo', addedLines: ['hi'] }]);
    assertReads(`${BEGIN}\n*** Update File: file.txt\n@@\n-old\n+new\n ${END}`, [
      { kind: 'update', path: 'file.txt', addedLines: ['new'], removedLines: ['old'] },
    ]);
  });

  it('takes a second end marker before the last line, with only blank lines between them', () => {
    const add: readonly PatchOperation[] = [{ kind: 'add', path: 'file.txt', addedLines: ['hello'] }];
    assertReads(patchOf('*** Add File: file.txt', '+hello', END), add);
    assertReads(patchOf('*** Add File: file.txt', '+hello', END, ' \t', ''), add);
    assertReads(patchOf('*** Update File: a.txt', '-old', END, ''), [
      { kind: 'update', path: 'a.txt', addedLines: [], removedLines: ['old'] },
    ]);
  });

  it('refuses text after an end marker, a hunk header too', () => {
    assertRefuses(patchOf('*** Add File: file.txt', '+hello', END, 'extra'), LAST_LINE);
    assertRefuses(patchOf('*** Add File: file.txt', '+hello', END, '*** Delete File: other.txt'), LAST_LINE);
  });
});

describe('readApplyPatch, a heredoc wrapper', () => {
  it('takes off each of the three openers Codex takes', () => {
    for (const opener of ['<<EOF', "<<'EOF'", '<<"EOF"']) {
      assertReads(`${opener}\n${FILE2_PATCH}\nEOF\n`, FILE2_OPERATIONS);
    }
  });

  it('refuses an opener whose quotes do not match', () => {
    assertRefuses(`<<"EOF'\n${FILE2_PATCH}\nEOF\n`, FIRST_LINE);
  });

  it('refuses an opener with a space after it, and a last line that does not end with EOF', () => {
    assertRefuses(`<<EOF \n${FILE2_PATCH}\nEOF\n`, FIRST_LINE);
    assertRefuses(`<<EOF\n${FILE2_PATCH}\nEND\n`, FIRST_LINE);
  });

  it('refuses a wrapper holding fewer than two lines', () => {
    assertRefuses(`<<EOF\n${BEGIN}\nEOF`, FIRST_LINE);
  });

  it('refuses a wrapped patch with a marker missing, naming that marker', () => {
    assertRefuses(`<<EOF\n${BEGIN}\n*** Update File: file2.py\nEOF\n`, LAST_LINE);
    assertRefuses(`<<EOF\nbad\n${END}\nEOF\n`, FIRST_LINE);
  });
});

describe('readApplyPatch, the operations', () => {
  it('reads an added, a deleted and an updated and moved file, in the patch order', () => {
    assertReads(
      patchOf(
        '*** Add File: path/add.py',
        '+abc',
        '+def',
        '*** Delete File: path/delete.py',
        '*** Update File: path/update.py',
        '*** Move to: path/update2.py',
        '@@ def f():',
        '-    pass',
        '+    return 123',
      ),
      [
        { kind: 'add', path: 'path/add.py', addedLines: ['abc', 'def'] },
        { kind: 'delete', path: 'path/delete.py' },
        {
          kind: 'update',
          path: 'path/update.py',
          moveTo: 'path/update2.py',
          addedLines: ['    return 123'],
          removedLines: ['    pass'],
        },
      ],
    );
  });

  it('reads an update hunk followed by another hunk', () => {
    assertReads(patchOf('*** Update File: file.py', '@@', '+line', '*** Add File: other.py', '+content'), [
      { kind: 'update', path: 'file.py', addedLines: ['line'], removedLines: [] },
      { kind: 'add', path: 'other.py', addedLines: ['content'] },
    ]);
  });

  it('reads an update hunk whose first chunk has no @@ line', () => {
    assertReads(FILE2_PATCH, FILE2_OPERATIONS);
  });

  it('gathers the added and removed lines of every chunk of a file', () => {
    assertReads(
      patchOf('*** Update File: src/config.rs', '@@ impl Config', '-a', '+b', ' kept', '@@ fn other()', '-c', '+d', '+'),
      [{ kind: 'update', path: 'src/config.rs', addedLines: ['b', 'd', ''], removedLines: ['a', 'c'] }],
    );
  });

  it('gives a path back as written, relative or absolute', () => {
    assertReads(
      patchOf(
        '*** Add File: relative-add.py',
        '+content',
        '*** Delete File: /work/absolute-delete.py',
        '*** Update File: D:\\work\\absolute-update.py',
        '@@',
        '-old',
        '+new',
      ),
      [
        { kind: 'add', path: 'relative-add.py', addedLines: ['content'] },
        { kind: 'delete', path: '/work/absolute-delete.py' },
        { kind: 'update', path: 'D:\\work\\absolute-update.py', addedLines: ['new'], removedLines: ['old'] },
      ],
    );
  });

  it('reads an added file with no line, and keeps a line as written after its +', () => {
    assertReads(patchOf('*** Add File: empty.txt'), [{ kind: 'add', path: 'empty.txt', addedLines: [] }]);
    assertReads(patchOf('*** Add File: a.txt', '+', '+ +x ', '++'), [
      { kind: 'add', path: 'a.txt', addedLines: ['', ' +x ', '+'] },
    ]);
  });

  it('keeps a path as written after the one space of its header', () => {
    assertReads(patchOf('*** Add File:  x'), [{ kind: 'add', path: ' x', addedLines: [] }]);
    assertReads(patchOf('*** Update File: a.txt', '-old', '*** Delete File:  y'), [
      { kind: 'update', path: 'a.txt', addedLines: [], removedLines: ['old'] },
      { kind: 'delete', path: ' y' },
    ]);
  });

  it('takes off a path the white space Rust trims, U+0085 too, and keeps U+FEFF, which Rust keeps', () => {
    assertReads(patchOf('*** Add File: a.txt\u0085', '*** Delete File: b.txt\u00a0\u3000'), [
      { kind: 'add', path: 'a.txt', addedLines: [] },
      { kind: 'delete', path: 'b.txt' },
    ]);
    assertReads(patchOf('*** Delete File: a.txt\ufeff'), [{ kind: 'delete', path: 'a.txt\ufeff' }]);
    assertReads(patchOf('*** Update File: a.txt\u0085', '*** Move to: b.txt\u0085', '-old'), [
      { kind: 'update', path: 'a.txt', moveTo: 'b.txt', addedLines: [], removedLines: ['old'] },
    ]);
  });

  it('trims the whole text as Rust does: U+0085 around it goes, a U+FEFF before it makes it no patch', () => {
    assertReads(`\u0085${BEGIN}\n${END}\u0085`, []);
    assertRefuses(`\ufeff${BEGIN}\n${END}`, FIRST_LINE);
    assertRefuses(`${BEGIN}\n${END}\ufeff`, LAST_LINE);
  });
});

describe('readApplyPatch, hunk headers', () => {
  it('reads an indented header as a header after an added or a deleted file', () => {
    assertReads(patchOf('*** Add File: a.txt', '+x', '  *** Delete File: b.txt', '\t*** Add File: c.txt  ', '+y'), [
      { kind: 'add', path: 'a.txt', addedLines: ['x'] },
      { kind: 'delete', path: 'b.txt' },
      { kind: 'add', path: 'c.txt', addedLines: ['y'] },
    ]);
  });

  it('reads an indented header inside an update hunk as a context line, not a new file', () => {
    assertReads(
      patchOf('*** Update File: a.txt', '@@', '-old a', '+new a', ' *** Update File: b.txt', '@@', '-old b', '+new b'),
      [{ kind: 'update', path: 'a.txt', addedLines: ['new a', 'new b'], removedLines: ['old a', 'old b'] }],
    );
  });

  it('reads a header with spaces after it inside an update hunk as a header', () => {
    assertReads(patchOf('*** Update File: a.txt', '-old', '*** Delete File: b.txt  '), [
      { kind: 'update', path: 'a.txt', addedLines: [], removedLines: ['old'] },
      { kind: 'delete', path: 'b.txt' },
    ]);
  });

  it('refuses a line that is no header where one must stand, with its line number', () => {
    assertRefuses(patchOf('bad'), notAHeader(2, 'bad'));
    assertRefuses(patchOf('*** Add File: file.txt', '  bad  '), notAHeader(3, 'bad'));
    assertRefuses(patchOf('*** Delete File: file.txt', 'bad'), notAHeader(3, 'bad'));
  });

  it('refuses a header with no path', () => {
    assertRefuses(patchOf('*** Add File: '), notAHeader(2, '*** Add File:'));
    assertRefuses(patchOf('*** Add File: a.txt', '*** Delete File:'), notAHeader(3, '*** Delete File:'));
  });
});

describe('readApplyPatch, the environment id', () => {
  it('gives the id of a patch that names one', () => {
    const operations: readonly PatchOperation[] = [{ kind: 'add', path: 'hello.txt', addedLines: ['hello'] }];
    assert.deepEqual(readApplyPatch(patchOf('*** Environment ID: remote', '*** Add File: hello.txt', '+hello')), {
      ok: true,
      operations,
      environmentId: 'remote',
    });
    assert.deepEqual(readApplyPatch(patchOf('  *** Environment ID:remote one  ')), {
      ok: true,
      operations: [],
      environmentId: 'remote one',
    });
  });

  it('refuses an empty id and a second id', () => {
    assertRefuses(
      patchOf('*** Environment ID:   ', '*** Add File: hello.txt', '+hello'),
      'invalid patch: apply_patch environment_id cannot be empty',
    );
    assertRefuses(
      patchOf('*** Environment ID: first', '*** Environment ID: second'),
      'invalid patch: apply_patch environment_id cannot be specified more than once',
    );
  });

  it('refuses an id after the first hunk header: it is no header there', () => {
    assertRefuses(
      patchOf('*** Add File: a.txt', '+x', '*** Environment ID: late'),
      notAHeader(4, '*** Environment ID: late'),
    );
    assertRefuses(
      patchOf('*** Update File: a.txt', '-old', '*** Environment ID: late'),
      contextMarkerExpected(4, '*** Environment ID: late'),
    );
  });
});

describe('readApplyPatch, the lines of an update hunk', () => {
  it('reads a bare empty line as a context line', () => {
    assertReads(patchOf('*** Update File: file.txt', '@@', ' context before', '', ' context after'), [
      { kind: 'update', path: 'file.txt', addedLines: [], removedLines: [] },
    ]);
    assertReads(patchOf('*** Update File: file.txt', '@@', ''), [
      { kind: 'update', path: 'file.txt', addedLines: [], removedLines: [] },
    ]);
  });

  it('reads an end of file line, skips blank lines after it and opens the next chunk only at an @@ line', () => {
    assertReads(patchOf('*** Update File: file.txt', '@@', '+quux', '*** End of File', ''), [
      { kind: 'update', path: 'file.txt', addedLines: ['quux'], removedLines: [] },
    ]);
    assertReads(patchOf('*** Update File: file.txt', '+quux', '*** End of File  ', '  ', '@@ next', '-x', '@@', '+y'), [
      { kind: 'update', path: 'file.txt', addedLines: ['quux', 'y'], removedLines: ['x'] },
    ]);
    assertRefuses(
      patchOf('*** Update File: file.txt', '@@', '+quux', '*** End of File', '+more'),
      contextMarkerExpected(6, '+more'),
    );
  });

  it('passes over an end of file line that no chunk comes before', () => {
    assertReads(patchOf('*** Update File: file.txt', '*** End of File', '+a'), [
      { kind: 'update', path: 'file.txt', addedLines: ['a'], removedLines: [] },
    ]);
    assertRefuses(
      patchOf('*** Update File: file.txt', '*** End of File'),
      invalidHunk(2, "Update file hunk for path 'file.txt' is empty"),
    );
  });

  it('refuses an update hunk with no chunk, at the line of its header', () => {
    assertRefuses(patchOf('*** Update File: test.py'), invalidHunk(2, "Update file hunk for path 'test.py' is empty"));
    assertRefuses(
      patchOf('*** Add File: a.txt', '*** Update File: old.txt', '*** Move to: new.txt', '*** Delete File: other.txt'),
      invalidHunk(3, "Update file hunk for path 'old.txt' is empty"),
    );
  });

  it('refuses a chunk with no line, whatever closes it', () => {
    assertRefuses(patchOf('*** Update File: file.txt', '@@'), invalidHunk(4, NO_LINES));
    assertRefuses(patchOf('*** Update File: file.txt', '@@', '*** End of File', '+a'), invalidHunk(4, NO_LINES));
    assertRefuses(patchOf('*** Update File: file.txt', '@@', '@@', '+a'), unexpectedLine(4, '@@'));
    assertRefuses(patchOf('*** Update File: file.txt', '@@ one', '@@ two  ', '+a'), unexpectedLine(4, '@@ two  '));
    assertRefuses(
      patchOf('*** Update File: file.txt', '@@', '*** Update File: other.txt', '+a'),
      unexpectedLine(4, '*** Update File: other.txt'),
    );
    assertRefuses(patchOf('*** Update File: file.txt', '@@', END, ''), invalidHunk(4, NO_LINES));
  });

  it('refuses a line with no sign: before any chunk line as unexpected, after one as a missing @@', () => {
    assertRefuses(patchOf('*** Update File: file.txt', 'bad'), unexpectedLine(3, 'bad'));
    assertRefuses(patchOf('*** Update File: file.txt', '@@', '\t'), unexpectedLine(4, '\t'));
    assertRefuses(patchOf('*** Update File: file.txt', '@@', '-old', 'bad'), contextMarkerExpected(5, 'bad'));
  });

  it('takes a move only as the first line of the hunk, and only once', () => {
    assertRefuses(
      patchOf('*** Update File: a.txt', '*** Move to: b.txt', '*** Move to: c.txt', '-old'),
      unexpectedLine(4, '*** Move to: c.txt'),
    );
    assertRefuses(
      patchOf('*** Update File: a.txt', '-old', '*** Move to: b.txt'),
      contextMarkerExpected(4, '*** Move to: b.txt'),
    );
  });
});

describe('readApplyPatch, line endings', () => {
  it('reads a patch whose lines end with a carriage return and a line feed', () => {
    assertReads(`${BEGIN}\r\n*** Update File: file.txt\r\n@@\r\n-old\r\n+new\r\n${END}\r\n`, [
      { kind: 'update', path: 'file.txt', addedLines: ['new'], removedLines: ['old'] },
    ]);
  });

  it('takes two carriage returns off a line, as Codex does when it reads a whole patch, and no more', () => {
    assertReads(`${BEGIN}\r\n*** Update File: file.txt\r\n@@\r\n-old\r\r\n+new\r\r\r\n${END}\r\n`, [
      { kind: 'update', path: 'file.txt', addedLines: ['new\r'], removedLines: ['old'] },
    ]);
  });
});

describe('readApplyPatch, the time it takes', () => {
  it('reads lines of 200,000 spaces before a letter within two seconds', () => {
    const spaces = ' '.repeat(200_000);
    const patch = patchOf(
      `*** Add File: a.txt${spaces}`,
      `+${spaces}x`,
      '*** Update File: b.txt',
      `-${spaces}x`,
      `${spaces}x`,
      `+${spaces}`,
    );
    const started = performance.now();
    assertReads(patch, [
      { kind: 'add', path: 'a.txt', addedLines: [`${spaces}x`] },
      { kind: 'update', path: 'b.txt', addedLines: [spaces], removedLines: [`${spaces}x`] },
    ]);
    assert.ok(performance.now() - started < 2000, `took ${Math.round(performance.now() - started)} ms`);
  });
});
