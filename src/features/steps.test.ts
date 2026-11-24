import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTOR_KINDS } from './feature.ts';
import { STEPS, isStepId, stepTextsProblems, stepsOf } from './steps.ts';

const STEP_ID = /^[a-z]+\.[a-z]+(-[a-z]+)*$/;

describe('the step registry', () => {
  it('names each step <group>.<name>, a connector step by a connector kind and a host step by host', () => {
    for (const [id, step] of Object.entries(STEPS)) {
      assert.match(id, STEP_ID);
      const group = id.slice(0, id.indexOf('.'));
      assert.ok(step.side === 'connector' ? CONNECTOR_KINDS.some((kind) => kind === group) : group === step.side, id);
    }
  });

  it('gives each step one line of what it covers and a fallback', () => {
    for (const [id, step] of Object.entries(STEPS)) {
      for (const text of [step.doc, step.fallback]) {
        assert.notEqual(text.trim(), '', id);
        assert.ok(!text.includes('\n'), id);
      }
    }
  });

  it('keeps every fallback neutral: no product a built-in adapter serves is named', () => {
    const products = /\b(GitHub|gh|Jira|JQL|Claude|Codex|pull request)\b|CLAUDE\.md|\.claude\/|\/clear/i;
    for (const [id, step] of Object.entries(STEPS)) assert.doesNotMatch(step.fallback, products, id);
  });

  it('tells a registry id from any other text', () => {
    assert.ok(isStepId('tracker.link-child'));
    for (const text of ['tracker.link', 'link-child', 'toString', '']) assert.ok(!isStepId(text), text);
  });

  it("lists one side's steps in registry order, and none for a side that serves none", () => {
    assert.deepEqual(stepsOf('connector'), ['tracker.link-child', 'codehost.private-report', 'codehost.fetch-outside-change']);
    assert.deepEqual(stepsOf('host'), ['host.rename', 'host.slim-setup', 'host.denial-sources']);
    assert.deepEqual(stepsOf('terminal'), []);
  });
});

describe("an adapter's step texts", () => {
  it('are sound with a text for each listed step and nothing more', () => {
    assert.deepEqual(stepTextsProblems(['host.rename'], { 'host.rename': 'Rename it so.' }), []);
    assert.deepEqual(stepTextsProblems([], {}), []);
  });

  it('name each listed step with no text, a blank one included, then each text for a step not listed', () => {
    assert.deepEqual(stepTextsProblems(['host.rename', 'host.slim-setup', 'host.denial-sources'], { 'host.rename': ' ', 'host.denial-sources': 3, 'tracker.link-child': 'Link it.' }), [
      'it lists the step host.rename and has no text for it',
      'it lists the step host.slim-setup and has no text for it',
      'it lists the step host.denial-sources and has no text for it',
      'it has a text for tracker.link-child, a step its declaration does not list',
    ]);
  });

  it('must be a record', () => {
    for (const value of [undefined, 'text', ['host.rename']]) assert.deepEqual(stepTextsProblems(['host.rename'], value), ['its stepTexts must be a record of one text per step it lists']);
  });
});
