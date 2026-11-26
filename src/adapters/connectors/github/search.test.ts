import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchIn } from './search.ts';

/** A search answer as GitHub's REST API prints it: the total it holds and the items of one page. */
function answer(total: unknown, items: unknown): string {
  return JSON.stringify({ total_count: total, incomplete_results: false, items });
}

/** The repository an item of acme/web names, as the REST API prints it. */
const WEB = { repository_url: 'https://api.github.com/repos/acme/web' };

describe('searchIn (T4860)', () => {
  it('reads each item as an issue or a pull request of the repository searched', () => {
    const items = [
      { ...WEB, number: 7, title: 'Login fails', state: 'open' },
      { ...WEB, number: 9, title: 'Fix login', state: 'closed', pull_request: { url: 'u' } },
      { ...WEB, number: 11, title: 'Null field', state: 'open', pull_request: null },
    ];
    assert.deepEqual(searchIn('acme/web', answer(3, items)), {
      issues: [
        { target: { repo: 'acme/web', number: 7 }, title: 'Login fails', state: 'open', pull: false },
        { target: { repo: 'acme/web', number: 9 }, title: 'Fix login', state: 'closed', pull: true },
        { target: { repo: 'acme/web', number: 11 }, title: 'Null field', state: 'open', pull: false },
      ],
      more: false,
    });
  });

  it('says there is more when the total passes the page, or an item did not read and was left out', () => {
    assert.equal(searchIn('acme/web', answer(40, [{ ...WEB, number: 7, title: 't', state: 'open' }]))?.more, true);
    const odd = [
      { ...WEB, number: 7, title: 't', state: 'open' },
      { ...WEB, number: 0, title: 't', state: 'open' },
      { ...WEB, number: 1.5, title: 't', state: 'open' },
      { ...WEB, number: '8', title: 't', state: 'open' },
      { ...WEB, number: 9, title: 't', state: 'merged' },
      { ...WEB, number: 10, state: 'open' },
      'not an item',
    ];
    assert.deepEqual(searchIn('acme/web', answer(odd.length, odd)), { issues: [{ target: { repo: 'acme/web', number: 7 }, title: 't', state: 'open', pull: false }], more: true });
  });

  it('keeps only the items of the repository searched, case aside, so the scope never rests on the query alone', () => {
    const items = [
      { ...WEB, number: 7, title: 'ours', state: 'open' },
      { repository_url: 'https://api.github.com/repos/ACME/Web', number: 8, title: 'ours, other case', state: 'open' },
      { repository_url: 'https://api.github.com/repos/other/secret', number: 9, title: 'theirs', state: 'open' },
      { repository_url: 'https://api.github.com/repos/acme/web-private', number: 10, title: 'a longer name', state: 'open' },
      { number: 11, title: 'no repository', state: 'open' },
    ];
    assert.deepEqual(searchIn('acme/web', answer(items.length, items)), {
      issues: [
        { target: { repo: 'acme/web', number: 7 }, title: 'ours', state: 'open', pull: false },
        { target: { repo: 'acme/web', number: 8 }, title: 'ours, other case', state: 'open', pull: false },
      ],
      more: true,
    });
  });

  it('reads nothing from an answer that is not a search', () => {
    for (const stdout of ['not json', '[]', '{}', answer('3', []), answer(3, {}), 'null']) {
      assert.equal(searchIn('acme/web', stdout), undefined, stdout);
    }
  });
});
