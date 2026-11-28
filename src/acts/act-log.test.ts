import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SecretScanner } from '../core/secrets.ts';
import { isRecord } from '../core/guards.ts';
import { fieldPaths } from '../testing/field-paths.ts';
import { ACT_LOG_VERSION, ACT_REASON_MAX, ActLog, actLine, encodedMark, type Act } from './act-log.ts';
import type { LogFile } from '../core/log-file.ts';

const ACT: Act = {
  at: new Date('2030-01-08T10:00:00Z'),
  ms: 12,
  session: 'alpha',
  by: { kind: 'agent', mark: 'CLAUDECODE' },
  host: 'claude-code',
  command: 'set',
  argv: ['set', 'T1', '--status', 'done'],
  outcome: 'refused',
  exit: 2,
  reason: 'T1 has no evidence',
};

function parsed(line: string): Record<string, unknown> {
  assert.ok(line.endsWith('\n'));
  const record: unknown = JSON.parse(line);
  assert.ok(isRecord(record));
  return record;
}

class ArrayLog implements LogFile {
  readonly lines: string[] = [];
  read(): Promise<string | undefined> {
    return Promise.resolve(this.lines.length === 0 ? undefined : this.lines.join(''));
  }
  append(text: string): Promise<void> {
    this.lines.push(text);
    return Promise.resolve();
  }
}

describe('actLine', () => {
  it('pins the fields of the current format', () => {
    assert.equal(ACT_LOG_VERSION, 1);
    assert.deepEqual(fieldPaths(JSON.parse(actLine(ACT, new SecretScanner()))), [
      'argv[]',
      'at',
      'by.kind',
      'by.mark',
      'command',
      'exit',
      'host',
      'joined',
      'ms',
      'outcome',
      'reason',
      'session',
      'v',
    ]);
  });

  it('writes one JSON line with every field of the act', () => {
    assert.deepEqual(parsed(actLine(ACT, new SecretScanner())), {
      v: ACT_LOG_VERSION,
      at: '2030-01-08T10:00:00.000Z',
      ms: 12,
      session: 'alpha',
      by: { kind: 'agent', mark: 'CLAUDECODE' },
      host: 'claude-code',
      command: 'set',
      argv: ['set', 'T1', '--status', 'done'],
      joined: false,
      outcome: 'refused',
      exit: 2,
      reason: 'T1 has no evidence',
    });
  });

  it('writes null for what the run did not name, and a person or untold run by its kind alone', () => {
    const person = parsed(actLine({ ...ACT, session: undefined, host: undefined, reason: undefined, by: { kind: 'person' } }, new SecretScanner()));
    assert.deepEqual([person['session'], person['host'], person['reason'], person['by']], [null, null, null, { kind: 'person' }]);
    assert.deepEqual(parsed(actLine({ ...ACT, by: { kind: 'untold' } }, new SecretScanner()))['by'], { kind: 'untold' });
  });

  it('redacts a secret in an argument or the reason, and the team patterns too', () => {
    const token = ['ghp', '_', 'a'.repeat(36)].join('');
    const record = parsed(actLine({ ...ACT, argv: ['inbox', 'add', '--text', `key ${token}`], reason: `saw ${token}` }, new SecretScanner(['INTERNAL-[0-9]+'])));
    assert.deepEqual(record['argv'], ['inbox', 'add', '--text', 'key [redacted GitHub token]']);
    assert.equal(record['reason'], 'saw [redacted GitHub token]');
    const team = parsed(actLine({ ...ACT, argv: ['add', 'INTERNAL-42'] }, new SecretScanner(['INTERNAL-[0-9]+'])));
    assert.doesNotMatch(JSON.stringify(team['argv']), /INTERNAL-42/);
  });

  it('redacts a secret a shell split over two words, keeping the redacted joined line', () => {
    const token = 'z'.repeat(32);
    const header = parsed(actLine({ ...ACT, argv: ['queue', '--', 'tool', 'Authorization:', 'Bearer', token] }, new SecretScanner()));
    assert.equal(header['joined'], true);
    assert.doesNotMatch(JSON.stringify(header['argv']), new RegExp(token));
    assert.match(JSON.stringify(header['argv']), /redacted/);
    const password = parsed(actLine({ ...ACT, argv: ['queue', '--', 'tool', 'password:', 'hunter2-long-value'] }, new SecretScanner()));
    assert.equal(password['joined'], true);
    assert.doesNotMatch(JSON.stringify(password['argv']), /hunter2-long-value/);
  });

  it('keeps the words apart when the joined line redacts nothing more', () => {
    const record = parsed(actLine(ACT, new SecretScanner()));
    assert.equal(record['joined'], false);
    assert.deepEqual(record['argv'], ['set', 'T1', '--status', 'done']);
  });

  it('keeps an encoded flag value by its length alone, given apart or after =', () => {
    const encoded = Buffer.from('secret prompt text', 'utf8').toString('base64url');
    const apart = parsed(actLine({ ...ACT, argv: ['launch', '--encoded-fake', encoded, 'T1'] }, new SecretScanner()));
    assert.deepEqual(apart['argv'], ['launch', '--encoded-fake', encodedMark(encoded), 'T1']);
    const after = parsed(actLine({ ...ACT, argv: ['launch', `--encoded-fake=${encoded}`] }, new SecretScanner()));
    assert.deepEqual(after['argv'], ['launch', `--encoded-fake=${encodedMark(encoded)}`]);
  });

  it('cuts a long reason to the limit, marking the cut', () => {
    const reason = parsed(actLine({ ...ACT, reason: 'x'.repeat(ACT_REASON_MAX + 50) }, new SecretScanner()))['reason'];
    assert.equal(typeof reason === 'string' ? reason.length : undefined, ACT_REASON_MAX);
    assert.ok(typeof reason === 'string' && reason.endsWith('…'));
    assert.equal(parsed(actLine({ ...ACT, reason: 'x'.repeat(ACT_REASON_MAX) }, new SecretScanner()))['reason'], 'x'.repeat(ACT_REASON_MAX));
  });
});

describe('ActLog', () => {
  it('appends each act as its line, in order', async () => {
    const file = new ArrayLog();
    const log = new ActLog(file, new SecretScanner());
    await log.append(ACT);
    await log.append({ ...ACT, command: 'add', outcome: 'ok', exit: 0, reason: undefined });
    assert.deepEqual(
      file.lines.map((line) => parsed(line)['command']),
      ['set', 'add'],
    );
  });
});
