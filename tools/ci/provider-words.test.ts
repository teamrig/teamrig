import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { type SkillFile, hitLine, providerHits, skillCounts, termPattern } from './provider-words.ts';

const file = (skill: string, ...lines: readonly string[]): SkillFile => ({ skill, path: `${skill}/SKILL.md`, text: lines.join('\n') });
/** One file's hits, each as `<line> <term>`. */
const hits = (source: SkillFile): string[] => providerHits([source]).map((hit) => `${hit.line} ${hit.term}`);

describe('termPattern', () => {
  it('bounds a term at its word-character edges, so gh never hits high or a longer word', () => {
    const gh = termPattern('gh');
    assert.equal('a high bar, ghost, ghx'.match(gh), null);
    assert.deepEqual('run gh pr, `gh`, gh:acme/web, teamrig-gh-acme'.match(gh), ['gh', 'gh', 'gh', 'gh']);
  });

  it('takes a non-word edge as it is and escapes the pattern characters', () => {
    assert.deepEqual('see .claude/skills and x.claude/y'.match(termPattern('.claude/')), ['.claude/', '.claude/']);
    assert.equal('see aclaude/'.match(termPattern('.claude/')), null);
    assert.deepEqual('type /clear, not /clearly'.match(termPattern('/clear')), ['/clear']);
    assert.equal('CLAUDExmd'.match(termPattern('CLAUDE.md')), null);
  });

  it('matches case-blind', () => {
    assert.deepEqual('GitHub, github.com, GITHUB_TOKEN'.match(termPattern('GitHub')), ['GitHub', 'github']);
    assert.deepEqual('Pull request and pull request'.match(termPattern('pull request')), ['Pull request', 'pull request']);
  });
});

describe('providerHits', () => {
  it("finds each term once per match, by line, in the terms' order, as the list spells it", () => {
    const skill = file('s/one', 'Open a pull request on GitHub with gh pr create.', 'Then /clear.', 'jira and JQL', 'nothing here');
    assert.deepEqual(hits(skill), ['1 GitHub', '1 gh', '1 pull request', '2 /clear', '3 Jira', '3 JQL']);
  });

  it('counts a term twice on one line', () => {
    assert.deepEqual(hits(file('s/one', 'GitHub, then GitHub again')), ['1 GitHub', '1 GitHub']);
  });

  it('prints a hit as path, line and term', () => {
    const [hit] = providerHits([file('s/one', '', 'Claude Code')]);
    assert.ok(hit);
    assert.equal(hitLine(hit), 's/one/SKILL.md:2: Claude Code');
  });
});

describe('skillCounts', () => {
  it("sums each skill's files and lists a skill with none at 0, sorted by folder", () => {
    const files = [file('s/two', 'GitHub'), file('s/one', 'nothing'), { skill: 's/two', path: 's/two/more.md', text: 'gh and JQL' }];
    assert.deepEqual([...skillCounts(files)], [['s/one', 0], ['s/two', 3]]);
  });
});
