import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from '../testing/config.ts';
import { Roster } from '../config/roster.ts';
import { TeamTree, teamNodeOf, type TeamNode } from '../config/tree.ts';
import type { RolesConfig } from '../config/types.ts';
import { treeNoteOf } from './tree-note.ts';

/** A team led by `lead` with one member `dev`, under `parent` when given, with extra roles when given. */
function team(id: string, parent?: string, roles: Partial<RolesConfig> = {}): TeamNode {
  const config = testConfig({ sessions: ['lead', 'dev'], roles: { lead: 'lead', ...roles }, team: parent === undefined ? { id } : { id, parent } });
  return teamNodeOf(id, config, new Roster(config, id));
}

describe('treeNoteOf', () => {
  it('says nothing for a team whose place in its tree is whole', () => {
    const tree = new TeamTree([team('app'), team('web', 'app')]);
    assert.equal(treeNoteOf(tree, 'web', 'teamrig'), undefined);
    assert.equal(treeNoteOf(tree, 'app', 'teamrig'), undefined);
  });

  it('names a parent with no team config in this home, with its fix and doctor', () => {
    const note = treeNoteOf(new TeamTree([team('web', 'corp')]), 'web', 'teamrig');
    assert.ok(note !== undefined);
    assert.match(note, /^This team's place in its tree is broken/);
    assert.match(note, /team web names parent corp, which has no team config/);
    assert.match(note, /`teamrig doctor` lists the tree's problems\.$/);
  });

  it('names a role left to a team that is not above, and joins several problems in one line', () => {
    const tree = new TeamTree([team('app'), team('web', 'corp', { securityReviewer: 'app/lead' })]);
    const note = treeNoteOf(tree, 'web', 'teamrig');
    assert.ok(note !== undefined);
    assert.match(note, /names parent corp, which has no team config.*; team web's roles\.securityReviewer names app\/lead, but team app is not above web/);
  });

  it('leaves another team\'s problems in the tree to doctor', () => {
    const tree = new TeamTree([team('app'), team('web', 'app'), team('ui', 'web', { securityReviewer: 'web/dev' })]);
    assert.equal(treeNoteOf(tree, 'web', 'teamrig'), undefined);
    assert.ok(treeNoteOf(tree, 'ui', 'teamrig') !== undefined);
  });
});
