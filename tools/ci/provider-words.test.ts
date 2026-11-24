import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Load } from '../../src/composition/loader.ts';
import { isConnectorDeclaration, isHostDeclaration, isTerminalDeclaration, type ConnectorDeclaration, type HostDeclaration, type TerminalDeclaration } from '../../src/plugin-api/index.ts';
import { connectorDeclarationData, hostDeclarationData, terminalDeclarationData } from '../../src/testing/manifests.ts';
import { type SkillFile, declaredTerms, hitLine, providerHits, skillCounts, termList, termPattern } from './provider-words.ts';

function host(over: Readonly<Record<string, unknown>>): Load<HostDeclaration> {
  const value = hostDeclarationData(over);
  assert.ok(isHostDeclaration(value));
  return { kind: 'loaded', id: value.id, value };
}

function connector(over: Readonly<Record<string, unknown>>): Load<ConnectorDeclaration> {
  const value = connectorDeclarationData(over);
  assert.ok(isConnectorDeclaration(value));
  return { kind: 'loaded', id: value.id, value };
}

function terminal(over: Readonly<Record<string, unknown>>): Load<TerminalDeclaration> {
  const value = terminalDeclarationData(over);
  assert.ok(isTerminalDeclaration(value));
  return { kind: 'loaded', id: value.id, value };
}

/** Three products' words, as three declarations would name them. */
const TERMS = termList([
  ['GitHub', 'gh', 'pull request'],
  ['Claude Code', 'CLAUDE.md', '.claude/', '/clear'],
  ['Jira', 'JQL'],
]);
const file = (skill: string, ...lines: readonly string[]): SkillFile => ({ skill, path: `${skill}/SKILL.md`, text: lines.join('\n') });
/** One file's hits, each as `<line> <term>`. */
const hits = (source: SkillFile, terms: readonly string[] = TERMS): string[] => providerHits([source], terms).map((hit) => `${hit.line} ${hit.term}`);

describe('termList', () => {
  it("keeps each declaration's words in order, and a word two adapters name once, as the first spells it", () => {
    assert.deepEqual(termList([['GitHub', 'gh'], [], ['github', 'Jira', 'GH']]), ['GitHub', 'gh', 'Jira']);
  });

  it('counts a word two adapters name once in a skill', () => {
    assert.deepEqual(hits(file('s/one', 'gh and GitHub'), termList([['GitHub', 'gh'], ['github']])), ['1 GitHub', '1 gh']);
  });

  it('counts nothing when no adapter names a word', () => {
    assert.deepEqual(hits(file('s/one', 'GitHub'), termList([])), []);
  });
});

describe('declaredTerms', () => {
  it("reads the hosts' words, then the connectors', then the terminals', a declaration with none adding nothing", () => {
    const terms = declaredTerms({
      hosts: [host({ id: 'cli-one', terms: ['/clear'] })],
      connectors: [connector({ id: 'hub', terms: ['gh', 'pull request'] }), connector({ id: 'plain' })],
      terminals: [terminal({ id: 'tty', terms: ['tmux'] })],
    });
    assert.deepEqual(terms, ['/clear', 'gh', 'pull request', 'tmux']);
  });

  it('stops on a declaration the loader refused, naming it and why', () => {
    const refused: Load<ConnectorDeclaration> = { kind: 'refused', id: 'broken', notices: ['it needs a name'] };
    assert.throws(() => declaredTerms({ hosts: [], connectors: [connector({ id: 'hub', terms: ['gh'] }), refused], terminals: [] }), {
      message: 'cannot read the terms of broken (it needs a name)',
    });
  });
});

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
    const [hit] = providerHits([file('s/one', '', 'Claude Code')], TERMS);
    assert.ok(hit);
    assert.equal(hitLine(hit), 's/one/SKILL.md:2: Claude Code');
  });
});

describe('skillCounts', () => {
  it("sums each skill's files and lists a skill with none at 0, sorted by folder", () => {
    const files = [file('s/two', 'GitHub'), file('s/one', 'nothing'), { skill: 's/two', path: 's/two/more.md', text: 'gh and JQL' }];
    assert.deepEqual([...skillCounts(files, TERMS)], [['s/one', 0], ['s/two', 3]]);
  });
});
