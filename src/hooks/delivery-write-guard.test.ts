import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { editEventOf, hookEventOf } from '../testing/host.ts';
import { deliveryWriteGuardReply, deliveryWritePlacesOf, deliveryWriteReach, isDeliveryPlace, writesAFile, type DeliveryWritePlaces } from './delivery-write-guard.ts';

const PATHS = { home: 'C:/kit/teams/app', state: 'C:/kit/teams/app/state', kitHome: 'C:/kit' } as const;
const DEFAULTS: DeliveryWritePlaces = deliveryWritePlacesOf({ queue: {} }, PATHS);

const call = (tool_name: string, tool_input: Record<string, string>, cwd?: string) =>
  hookEventOf({ hook_event_name: 'PreToolUse', tool_name, tool_input, ...(cwd === undefined ? {} : { cwd }) });
const write = (file_path: string, cwd?: string) => call('Write', { file_path, content: '{}' }, cwd);
const edited = (path: string | undefined) => ({ path, texts: [], change: undefined });

describe('isDeliveryPlace', () => {
  it("holds the queue's own files: the detached and parked runs, the ledger, the host lock and its siblings, the freezes", () => {
    for (const path of [
      'C:/kit/teams/app/state/deploys/detached/20261118-051705-28192.json',
      'C:/kit/teams/app/state/deploys/detached/parked/20261118-051705-28192.json',
      'C:/kit/teams/app/state/deploys/ledger.jsonl',
      'C:/kit/host.lock',
      'C:/kit/host.lock.line',
      'C:/kit/pipeline-freezes.json',
      'C:/kit/pipeline-freezes.lock',
    ]) {
      assert.equal(isDeliveryPlace(path, DEFAULTS), true, path);
    }
  });

  it('matches whatever the slashes or case, and resolves a `..` in the path', () => {
    for (const path of [
      'C:\\kit\\teams\\app\\state\\deploys\\ledger.jsonl',
      'c:/KIT/Teams/App/State/Deploys/Detached/a.log',
      'C:/kit/teams/app/notes/../state/deploys/ledger.jsonl',
    ]) {
      assert.equal(isDeliveryPlace(path, DEFAULTS), true, path);
    }
  });

  it("leaves the hand-written ledger.md, a longer name, the folder itself and the team's other files open", () => {
    for (const path of [
      'C:/kit/teams/app/state/deploys/ledger.md',
      'C:/kit/host.lockx',
      'C:/kit/teams/app/state/deploys/detached',
      'C:/kit/teams/app/state/deploys/detached-notes/a.md',
      'C:/kit/teams/app/notes/board.md',
    ]) {
      assert.equal(isDeliveryPlace(path, DEFAULTS), false, path);
    }
  });

  it("takes the team's delivery folder and host lock from its config, a relative one in the team's folder", () => {
    const places = deliveryWritePlacesOf({ dir: 'delivery', queue: { lockPath: 'locks/queue.lock' } }, PATHS);
    assert.equal(isDeliveryPlace('C:/kit/teams/app/delivery/detached/a.json', places), true);
    assert.equal(isDeliveryPlace('C:/kit/teams/app/locks/queue.lock.line', places), true);
    assert.equal(isDeliveryPlace('C:/kit/teams/app/locks/pipeline-freezes.json', places), true);
    assert.equal(isDeliveryPlace('C:/kit/teams/app/state/deploys/ledger.jsonl', places), false);
    assert.equal(isDeliveryPlace('C:/kit/host.lock', places), false);
  });
});

describe('deliveryWriteReach', () => {
  it('names each file tool writing a delivery file', () => {
    for (const tool of ['Write', 'Edit']) {
      assert.equal(deliveryWriteReach(call(tool, { file_path: 'C:/kit/host.lock' }), DEFAULTS), `this ${tool} writes C:/kit/host.lock, a file of the delivery queue`);
    }
  });

  it('names the delivery file among the several a patch writes', () => {
    const patch = editEventOf({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {} }, [edited('C:/work/app/a.ts'), edited(undefined), edited('C:/kit/teams/app/state/deploys/ledger.jsonl')]);
    assert.equal(deliveryWriteReach(patch, DEFAULTS), 'this apply_patch writes C:/kit/teams/app/state/deploys/ledger.jsonl, a file of the delivery queue');
  });

  it("reads a relative path from the call's folder", () => {
    assert.match(deliveryWriteReach(write('deploys/ledger.jsonl', 'C:/kit/teams/app/state'), DEFAULTS) ?? '', /^this Write writes /);
    assert.equal(deliveryWriteReach(write('deploys/ledger.jsonl', 'C:/work/app'), DEFAULTS), undefined);
  });

  it('passes a read, a shell line and a write anywhere else', () => {
    assert.equal(deliveryWriteReach(call('Read', { file_path: 'C:/kit/host.lock' }), DEFAULTS), undefined);
    assert.equal(deliveryWriteReach(call('Bash', { command: 'tail C:/kit/teams/app/state/deploys/detached/a.log' }), DEFAULTS), undefined);
    assert.equal(deliveryWriteReach(write('C:/work/app/src/a.ts'), DEFAULTS), undefined);
  });
});

describe('writesAFile', () => {
  it('holds a file tool that names a file, and nothing else', () => {
    assert.equal(writesAFile(write('C:/work/app/a.ts')), true);
    assert.equal(writesAFile(call('Write', { content: '{}' })), false);
    assert.equal(writesAFile(call('Bash', { command: 'ls' })), false);
    assert.equal(writesAFile(call('Read', { file_path: 'C:/work/app/a.ts' })), false);
  });
});

describe('deliveryWriteGuardReply', () => {
  it('refuses a write of a delivery file, naming the commands that keep them', () => {
    const reply = deliveryWriteGuardReply(write('C:/kit/teams/app/state/deploys/detached/parked/a.json'), DEFAULTS);
    assert.equal(reply?.verdict?.kind, 'deny');
    assert.match(reply?.verdict?.reason ?? '', /teamrig delivery guard: this Write writes .*Only the teamrig CLI writes the queue's files.*teamrig queue/);
  });

  it('gives no reply for any other call', () => {
    assert.equal(deliveryWriteGuardReply(write('C:/work/app/a.ts'), DEFAULTS), undefined);
    assert.equal(deliveryWriteGuardReply(call('Bash', { command: 'ls' }), DEFAULTS), undefined);
  });
});
