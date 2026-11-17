import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { carriesToUsers, hasCarrier, parseReach, REACH_VALUES, reachRefusal, reachValueOf } from './reach.ts';

describe('reachValueOf', () => {
  it('reads a Reach line anywhere in the note', () => {
    assert.equal(reachValueOf('Reach: plugin: a hook every team runs\n\n## What\n- x'), 'plugin: a hook every team runs');
    assert.equal(reachValueOf('## What\n- x\r\nReach: team\r\n'), 'team');
  });

  it('reads the first line of a ## Reach section, past blanks and the template comment', () => {
    assert.equal(reachValueOf('## Reach\n<!-- All users ... -->\n\ncontributors (CI)\n## Changes'), 'contributors (CI)');
  });

  it('gives an empty value for an empty section, and null when the note names no reach', () => {
    assert.equal(reachValueOf('## Reach\n<!-- fill me -->\n\n## Changes\n- x'), '');
    assert.equal(reachValueOf('## Reach'), '');
    assert.equal(reachValueOf('Reach:'), '');
    assert.equal(reachValueOf('## What\n- the reach of a hook\nOut of reach: none'), null);
  });
});

describe('parseReach', () => {
  it('takes each of the four values, with any words after them', () => {
    assert.deepEqual(parseReach('plugin'), { kind: 'reach', reach: 'plugin' });
    assert.deepEqual(parseReach('contributors: the PR template'), { kind: 'reach', reach: 'contributors' });
    assert.deepEqual(parseReach('team (one team rules file)'), { kind: 'reach', reach: 'team' });
    assert.deepEqual(parseReach('dev-only (only the release host runs it)'), { kind: 'reach', reach: 'dev-only' });
    assert.deepEqual(parseReach('dev-only(the maintainers ship tool)'), { kind: 'reach', reach: 'dev-only' });
  });

  it('refuses dev-only with no reason in parentheses', () => {
    for (const value of ['dev-only', 'dev-only ()', 'dev-only (  )', 'dev-only: ship tool']) {
      const parsed = parseReach(value);
      assert.equal(parsed.kind, 'refused', value);
      assert.match(parsed.kind === 'refused' ? parsed.why : '', /dev-only with no reason/);
    }
  });

  it('refuses a word that only starts like a value, naming the four values', () => {
    for (const value of ['teamrig development only', 'plugins', 'all users', 'contributor']) {
      const parsed = parseReach(value);
      assert.deepEqual(parsed, { kind: 'refused', why: `its Reach "${value}" is none of ${REACH_VALUES}` }, value);
    }
  });
});

describe('hasCarrier', () => {
  it('takes an issue number or none with its reason', () => {
    assert.equal(hasCarrier('Reach: dev-only (x)\nPlugin carrier: #123'), true);
    assert.equal(hasCarrier('Plugin carrier: #123, the queue flag'), true);
    assert.equal(hasCarrier('Plugin carrier: none: only the release host runs it'), true);
  });

  it('refuses a missing line, an empty one, a bare none and a number that is not an issue', () => {
    for (const note of ['Reach: dev-only (x)', 'Plugin carrier:', 'Plugin carrier: none', 'Plugin carrier: none:', 'Plugin carrier: #12a', 'Plugin carrier: 123']) {
      assert.equal(hasCarrier(note), false, note);
    }
  });
});

describe('carriesToUsers', () => {
  it('is the repository tooling and its dev skills only', () => {
    assert.equal(carriesToUsers('tools/ship/merge.ts'), true);
    assert.equal(carriesToUsers('.claude/skills/dev-ship-change/SKILL.md'), true);
    assert.equal(carriesToUsers('.claude/skills/other/SKILL.md'), false);
    assert.equal(carriesToUsers('src/cli/run.ts'), false);
    assert.equal(carriesToUsers('docs/tools/x.md'), false);
  });
});

describe('reachRefusal', () => {
  it('refuses a note with no reach or an empty one, naming the four values', () => {
    for (const note of ['## What\n- x', 'Reach:', '## Reach\n<!-- x -->\n## Changes']) {
      assert.equal(reachRefusal(note, ['src/a.ts']), `the pull request note states no reach: start it with "Reach: ${REACH_VALUES}"`, note);
    }
  });

  it('refuses an unknown value and a dev-only with no reason', () => {
    assert.match(reachRefusal('Reach: teamrig development', ['tools/a.ts']) ?? '', /is none of plugin \| contributors/);
    assert.match(reachRefusal('Reach: dev-only ()', ['docs/a.md']) ?? '', /dev-only with no reason/);
  });

  it('refuses a dev-only change of the tooling that names no plugin carrier, naming the file and both forms', () => {
    const refusal = reachRefusal('Reach: dev-only (the release host only)', ['docs/a.md', '.claude/skills/dev-x/SKILL.md', 'tools/b.ts']);
    assert.equal(
      refusal,
      'the pull request note is dev-only and the change touches .claude/skills/dev-x/SKILL.md, but it names no plugin carrier: add "Plugin carrier: #<n>" (the issue that brings it to every user) or "Plugin carrier: none: <why no user needs it>"'
    );
  });

  it('passes a dev-only change of the tooling with its carrier, and one that touches no tooling', () => {
    assert.equal(reachRefusal('Reach: dev-only (x)\nPlugin carrier: #123', ['tools/a.ts']), null);
    assert.equal(reachRefusal('Reach: dev-only (x)\nPlugin carrier: none: only the release host runs it', ['tools/a.ts']), null);
    assert.equal(reachRefusal('Reach: dev-only (x)', ['CONTRIBUTING.md']), null);
  });

  it('needs no carrier for a plugin, contributors or team change', () => {
    for (const reach of ['plugin', 'contributors', 'team']) assert.equal(reachRefusal(`Reach: ${reach}`, ['tools/a.ts']), null, reach);
  });
});
