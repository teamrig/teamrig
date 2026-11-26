import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonRecord, SiteTrust } from '../../../plugin-api/index.ts';
import { CONFIG_KEYS, MAX_PEOPLE, parseJiraConfig, type JiraConfig } from './config.ts';

const NO_TRUST_RULE: SiteTrust = { inside: undefined, never: [], edits: undefined, projects: new Map() };

interface Read {
  readonly config: JiraConfig;
  readonly problems: readonly string[];
}

/** The section as the connector reads it, beside every problem it reported, each as `<key> <problem>`. */
function read(section: JsonRecord): Read {
  const problems: string[] = [];
  const config = parseJiraConfig(section, (key, problem) => problems.push(`${key} ${problem}`));
  return { config, problems };
}

const NOTHING: JiraConfig = { site: undefined, projects: [], issueType: undefined, people: [], trust: NO_TRUST_RULE };
const SITE = "site must be the site's name, the part before .atlassian.net (acme for acme.atlassian.net), not ";
const PROJECTS = 'projects must be a list of project keys, as Jira spells them (["ENG"])';
const ISSUE_TYPE = 'issueType must be the name of an issue type on one line, as the project lists it (Task), not ';
const PEOPLE = 'people must be a list of Jira account ids (["5b10ac8d82e05b22cc7d4ef5"])';
const ACCOUNT = 'must be a Jira account id, letters, digits, :, _ or - (5b10ac8d82e05b22cc7d4ef5), not';

describe("the Jira connector's config section (T4766)", () => {
  it('reads an empty section as no site, no project and its own pick of a type', () => {
    assert.deepEqual(read({}), { config: NOTHING, problems: [] });
  });

  it('reads the site in lowercase, each project key in capitals and the issue type as written', () => {
    assert.deepEqual(read({ site: ' Acme ', projects: ['ENG', 'ops', ' Web_2 '], issueType: ' Bug ' }), {
      config: { site: 'acme', projects: ['ENG', 'OPS', 'WEB_2'], issueType: 'Bug', people: [], trust: NO_TRUST_RULE },
      problems: [],
    });
    assert.deepEqual(read({ site: 'acme-labs' }).config, { ...NOTHING, site: 'acme-labs' });
  });

  it('declares the keys it reads, each with its line', () => {
    assert.deepEqual(Object.keys(CONFIG_KEYS), ['site', 'projects', 'issueType', 'people', 'trust']);
    assert.deepEqual(Object.keys(read({ site: 'acme' }).config), Object.keys(CONFIG_KEYS));
  });

  it('reports a site that is no site name, one that could spell another host too, and reads none', () => {
    for (const site of ['acme.atlassian.net', 'https://acme.atlassian.net', 'acme/eng', 'evil.example', '', '-acme', 7, null, ['acme']]) {
      assert.deepEqual(read({ site }), { config: NOTHING, problems: [`${SITE}${JSON.stringify(site)}`] }, JSON.stringify(site));
    }
  });

  it('reports projects that are no list of keys, and reads none', () => {
    for (const projects of ['ENG', { ENG: true }, ['ENG', 7], null]) {
      assert.deepEqual(read({ site: 'acme', projects }), { config: { ...NOTHING, site: 'acme' }, problems: [PROJECTS] }, JSON.stringify(projects));
    }
  });

  it('reports each entry that is no project key or names one again, by its place, and keeps the rest', () => {
    assert.deepEqual(read({ site: 'acme', projects: ['ENG', 'acme/eng', 'eng', '2FA', '', 'OPS'] }), {
      config: { ...NOTHING, site: 'acme', projects: ['ENG', 'OPS'] },
      problems: [
        'projects[1] must be a project key, a letter then letters, digits or _ (ENG), not "acme/eng"',
        'projects[2] names ENG a second time',
        'projects[3] must be a project key, a letter then letters, digits or _ (ENG), not "2FA"',
        'projects[4] must be a project key, a letter then letters, digits or _ (ENG), not ""',
      ],
    });
  });

  it('reports projects with no site to live on, once, and not beside a site that is already reported', () => {
    assert.deepEqual(read({ projects: ['ENG'] }), { config: { ...NOTHING, projects: ['ENG'] }, problems: ['site must name the site its projects live on'] });
    assert.deepEqual(read({ projects: [] }), { config: NOTHING, problems: [] });
    assert.deepEqual(read({ site: 'a.b', projects: ['ENG'] }).problems, [`${SITE}"a.b"`]);
  });

  it('reports an issue type that is no name on one line, and reads the pick of the connector', () => {
    for (const issueType of ['', '  ', 'Bug\nTask', 7, null, ['Bug']]) {
      assert.deepEqual(read({ issueType }), { config: NOTHING, problems: [`${ISSUE_TYPE}${JSON.stringify(issueType)}`] }, JSON.stringify(issueType));
    }
  });

  it('reads the people as trimmed account ids, each once (T5013)', () => {
    assert.deepEqual(read({ people: [' 5b10ac8d82e05b22cc7d4ef5 ', '712020:2f6e-a_b'] }).config, { ...NOTHING, people: ['5b10ac8d82e05b22cc7d4ef5', '712020:2f6e-a_b'] });
  });

  it('reports people that are no list of ids, and reads none (T5013)', () => {
    for (const people of ['abc', { abc: true }, ['abc', 7], null]) {
      assert.deepEqual(read({ people }), { config: NOTHING, problems: [PEOPLE] }, JSON.stringify(people));
    }
  });

  it('reports each person that is no account id, names one again or is past the bound, and keeps the rest (T5013)', () => {
    assert.deepEqual(read({ people: ['abc', 'a"b', 'abc', '', 'x y', 'def'] }), {
      config: { ...NOTHING, people: ['abc', 'def'] },
      problems: [
        `people[1] ${ACCOUNT} "a\\"b"`,
        'people[2] names abc a second time',
        `people[3] ${ACCOUNT} ""`,
        `people[4] ${ACCOUNT} "x y"`,
      ],
    });
    const many = Array.from({ length: MAX_PEOPLE + 1 }, (_, index) => `id${index}`);
    const read101 = read({ people: many });
    assert.deepEqual(read101.config.people, many.slice(0, MAX_PEOPLE));
    assert.deepEqual(read101.problems, [`people[${MAX_PEOPLE}] is past the ${MAX_PEOPLE} account ids the section may name`]);
  });

  it('reports every problem of a section at once', () => {
    assert.equal(read({ site: 7, projects: 'ENG', issueType: '', people: 'abc' }).problems.length, 4);
  });
});
