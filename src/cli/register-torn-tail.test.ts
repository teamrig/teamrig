import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../register/fold.ts';
import { readEvents } from '../register/snapshot.ts';
import { CliHarness, EVENTS_PATH, TEAM } from '../testing/cli-harness.ts';
import { EXIT } from './runtime.ts';

const ADD = ['--description', 'what and why', '--priority', 'p1', '--session', 'alpha'];

/** The task ids and titles the register's events hold, read back as a later run reads them. */
function tasksOf(kit: CliHarness): readonly (readonly [string, string])[] {
  const tasks = foldEvents(readEvents(kit.files.get(EVENTS_PATH) ?? '').events).tasks;
  return [...tasks.values()].map((task) => [task.id, task.title] as const);
}

/** A register holding T1, its last line then torn by `tail` (a writer that died mid-line). */
async function tornAfterFirst(tail: (lastLine: string) => string): Promise<{ readonly kit: CliHarness; readonly before: string }> {
  const kit = new CliHarness(TEAM);
  assert.equal((await kit.run(['add', '--title', 'First', ...ADD])).code, EXIT.ok);
  const lines = (kit.files.get(EVENTS_PATH) ?? '').trimEnd().split('\n');
  const before = [...lines.slice(0, -1), tail(lines.at(-1) ?? '')].join('\n');
  await kit.files.write(EVENTS_PATH, before);
  return { kit, before };
}

describe('a register append after a torn last line (#2290)', () => {
  for (const [name, tail] of [
    ['an incomplete record', (line: string) => `${line}\n{"v":1,"type":"cre`],
    ['a whole record without its newline', (line: string) => line],
  ] as const) {
    it(`keeps the new task and every byte before it after ${name}, and the next add takes a new id`, async () => {
      const { kit, before } = await tornAfterFirst(tail);
      for (const title of ['Second', 'Third']) {
        const added = await kit.run(['add', '--title', title, ...ADD]);
        assert.equal(added.code, EXIT.ok, added.stdout.join('\n'));
      }
      const tasks = tasksOf(kit);
      assert.deepEqual(
        tasks.map(([, title]) => title),
        ['First', 'Second', 'Third'],
      );
      assert.equal(new Set(tasks.map(([id]) => id)).size, 3, tasks.join(' '));
      assert.ok((kit.files.get(EVENTS_PATH) ?? '').startsWith(`${before}\n`), 'the bytes before the append stay as they were');
    });
  }
});
