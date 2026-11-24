import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostDeclarationData } from '../testing/manifests.ts';
import { ADAPTER_ID, adapterEntry, declarationProblems } from './declaration.ts';

describe('an adapter declaration', () => {
  it('holds an API version, an id, a name and a manifest of its side', () => {
    assert.deepEqual(declarationProblems('host', hostDeclarationData()), []);
  });

  it('names its adapter by lower-case words joined by -', () => {
    for (const id of ['github', 'claude-code', 'codex-cli', 'tool2']) assert.match(id, ADAPTER_ID);
    for (const id of ['GitHub', 'claude code', '-jira', 'jira-', '2tool', '']) assert.doesNotMatch(id, ADAPTER_ID);
  });

  it('lists every field that is wrong, then what is wrong with the manifest', () => {
    assert.deepEqual(declarationProblems('host', hostDeclarationData({ apiVersion: '1', id: 'Some CLI', name: ' ', manifest: null })), [
      'its apiVersion must be a version like 1.0.0',
      'its id must be lower-case words joined by -',
      'it needs a name',
      'its manifest is not an object',
    ]);
    assert.deepEqual(declarationProblems('connector', {}), [
      'its apiVersion must be a version like 1.0.0',
      'its id must be lower-case words joined by -',
      'it needs a name',
      'its manifest is not an object',
    ]);
  });

  it('is checked against the side asked for', () => {
    assert.equal(declarationProblems('connector', hostDeclarationData()).length > 0, true);
  });

  it('is refused when it is no object', () => {
    assert.deepEqual(declarationProblems('host', 'claude-code'), ['its declaration is not an object']);
  });
});

describe('an adapter entry', () => {
  it('is a declaration beside the function its side needs', () => {
    const declaration = hostDeclarationData();
    assert.deepEqual(adapterEntry({ declaration, create: () => ({}) }, 'create'), { declaration });
    assert.deepEqual(adapterEntry({ create: () => ({}) }, 'create'), { declaration: undefined });
    assert.deepEqual(adapterEntry({ declaration, configure: () => () => ({}) }, 'configure'), { declaration });
  });

  it('is nothing else', () => {
    assert.equal(adapterEntry({ declaration: hostDeclarationData() }, 'create'), undefined);
    assert.equal(adapterEntry({ declaration: hostDeclarationData(), create: 'later' }, 'create'), undefined);
    assert.equal(adapterEntry({ declaration: hostDeclarationData(), create: () => ({}) }, 'configure'), undefined);
    assert.equal(adapterEntry({ declaration: hostDeclarationData(), configure: () => () => ({}) }, 'create'), undefined);
    assert.equal(adapterEntry(undefined, 'create'), undefined);
  });
});

describe("an adapter declaration's steps and terms", () => {
  it('may leave both out, or list registry steps of its own side and its product words', () => {
    assert.deepEqual(declarationProblems('host', hostDeclarationData({ steps: ['host.rename', 'host.slim-setup'], terms: ['Some CLI', '/reset'] })), []);
  });

  it('refuses a step of another side, an unknown step and a step listed twice', () => {
    assert.deepEqual(declarationProblems('host', hostDeclarationData({ steps: ['tracker.link-child', 'host.nap'] })), [
      'its steps name tracker.link-child, which is no host step of the step registry',
      'its steps name host.nap, which is no host step of the step registry',
    ]);
    assert.deepEqual(declarationProblems('host', hostDeclarationData({ steps: ['host.rename', 'host.rename'] })), ['its steps must list host steps of the step registry, each once']);
    assert.deepEqual(declarationProblems('host', hostDeclarationData({ steps: 'host.rename' })), ['its steps must list host steps of the step registry, each once']);
  });

  it('refuses an empty term, a term over two lines and one word twice in two spellings', () => {
    for (const terms of [[''], ['a\nb'], ['Tool', 'tool'], 'Tool']) {
      assert.deepEqual(declarationProblems('host', hostDeclarationData({ terms })), ['its terms must be words of its product, one line each, each once'], JSON.stringify(terms));
    }
  });
});
