import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { plainWordsOf, routeLineOf } from './route-line.ts';

describe('plainWordsOf', () => {
  it('gives the words of one plain command, after quote removal', () => {
    assert.deepEqual(plainWordsOf('teamrig merge --session tr-x'), ['teamrig', 'merge', '--session', 'tr-x']);
    assert.deepEqual(plainWordsOf(`git commit -s -m 'fix: the "a" case'`), ['git', 'commit', '-s', '-m', 'fix: the "a" case']);
    assert.deepEqual(plainWordsOf('  git\tstatus  '), ['git', 'status']);
    assert.deepEqual(plainWordsOf(`git commit -m ''`), ['git', 'commit', '-m', '']);
  });

  it('takes a standalone 2>&1, and only that redirection', () => {
    assert.deepEqual(plainWordsOf('git push origin t1-x 2>&1'), ['git', 'push', 'origin', 't1-x']);
    assert.deepEqual(plainWordsOf('2>&1 git status'), ['git', 'status']);
    for (const line of ['git status 2>/dev/null', 'git status >&2', 'git status 2>&1x', 'git status x2>&1', 'git status 1>&2', 'git status &>/dev/null']) {
      assert.equal(plainWordsOf(line), undefined, line);
    }
  });

  it('refuses text that may join, feed, redirect or substitute another command, quoted or not', () => {
    for (const line of [
      'git status; rm -rf x',
      'git status && git push',
      'git status | tail',
      'git status &',
      'git status > out',
      'git status < in',
      'git status <<EOF',
      'echo `id`',
      'echo $(id)',
      'echo ${B}',
      `git commit -m 'a; b'`,
      `git commit -m "a > b"`,
      `git commit -m 'a|b'`,
      `git commit -m 'a $(b)'`,
    ]) {
      assert.equal(plainWordsOf(line), undefined, line);
    }
  });

  it('lets a # through only inside a bare owner/name#number word, which bash reads as literal text', () => {
    assert.deepEqual(plainWordsOf('teamrig pr approve acme/web#7 --session tr-x'), ['teamrig', 'pr', 'approve', 'acme/web#7', '--session', 'tr-x']);
    assert.deepEqual(plainWordsOf('teamrig pr merge my.org/my_repo-2#1234567890'), ['teamrig', 'pr', 'merge', 'my.org/my_repo-2#1234567890']);
    const head = '0123456789abcdef0123456789abcdef01234567';
    assert.deepEqual(plainWordsOf(`teamrig pr approve acme/web#7 --head ${head} --session x`), ['teamrig', 'pr', 'approve', 'acme/web#7', '--head', head, '--session', 'x']);
    for (const line of [
      'teamrig pr approve a#7',
      'teamrig pr approve x.y#7',
      'teamrig pr approve --flag#7',
      'teamrig pr approve -a/b#7',
      'teamrig pr approve .a/b#7',
      'teamrig pr approve a/b#07',
      'teamrig pr approve a/b#7x',
      'teamrig pr approve a/b#7#',
      'teamrig pr approve ${a#b}',
      'teamrig pr approve $#',
      'teamrig pr approve --head=a/b#7',
      'teamrig pr approve @a/b#7',
      'teamrig pr approve !a/b#7',
      'teamrig pr approve (a/b#7)',
      'teamrig pr approve a/b#7;x',
      'teamrig pr approve x#y',
    ]) {
      assert.equal(plainWordsOf(line), undefined, line);
    }
    for (const line of [
      'teamrig pr approve #7',
      'teamrig pr approve a #7',
      'teamrig pr approve acme/web #7',
      'teamrig pr approve x#7',
      'teamrig pr approve web#7#8',
      'teamrig pr approve acme/web#7#8',
      'teamrig pr approve acme/web#x',
      'teamrig pr approve acme/web#07',
      'teamrig pr approve acme/web#12345678901',
      'teamrig pr approve acme/web#',
      'teamrig pr approve acme/web#7;id',
      'teamrig pr approve acme/web#7x',
      `teamrig pr approve 'acme/web#7'`,
      `teamrig pr approve "acme/web#7"`,
      `git commit -m '#'`,
      'git status # acme/web#7',
    ]) {
      assert.equal(plainWordsOf(line), undefined, line);
    }
  });

  it(`refuses $'...' and $"...", whose value is not the text the line shows, and the same two characters inside quotes`, () => {
    for (const line of [
      "git commit -m x $'\\0'--no-verify",
      "git commit -m x $'\\x00'--no-verify",
      "git commit -m x $'\\000'--no-verify",
      "git commit -m x $'\\u0000'--no-verify",
      "git commit -m x $'\\c@'--no-verify",
      "git commit -m x $'\\c@'-n",
      "git commit -m x $'\\c-n'",
      "git commit -m x $'\\cA'--no-verify",
      "git commit -m x $'a\\0b'--no-verify",
      "git commit -m $'x'",
      'git commit -m $"x"',
      "git commit -m 'costs 5$'",
    ]) {
      assert.equal(plainWordsOf(line), undefined, line);
    }
  });

  it('refuses a control character: a newline, a carriage return, a NUL, a DEL', () => {
    for (const line of ['git status\ngit push', 'git status\r', 'git\u0000status', 'git status\u007f', 'git \\\nstatus']) {
      assert.equal(plainWordsOf(line), undefined, JSON.stringify(line));
    }
  });

  it('refuses a word only known when it runs, or one bash expands', () => {
    for (const line of ['git push $R t1-x', 'git push "$R" t1-x', 'ls *.ts', 'ls a?b', 'ls [ab]', 'cat ~/x', 'echo {a,b}', 'echo $1']) {
      assert.equal(plainWordsOf(line), undefined, line);
    }
  });

  it('refuses a line it cannot read whole, a subshell, a leading assignment, an empty line', () => {
    for (const line of [`git commit -m 'open`, '(git status)', '{ git status; }','GIT_DIR=/x git push origin t1-x', '', '   ', 'echo $((1 + 2))']) {
      assert.equal(plainWordsOf(line), undefined, JSON.stringify(line));
    }
  });

  it('refuses a word that holds a substitution an expansion may run again', () => {
    assert.equal(plainWordsOf(`printf -v 'a[$(id)]' x`), undefined);
  });
});

describe('routeLineOf', () => {
  it('gives a plain line with no filter', () => {
    assert.deepEqual(routeLineOf('teamrig list --session tr-x'), { words: ['teamrig', 'list', '--session', 'tr-x'], filter: undefined });
  });

  it('F2: splits a line at one top-level | into the route and its filter', () => {
    assert.deepEqual(routeLineOf('teamrig list --session tr-x | tail -n 5'), {
      words: ['teamrig', 'list', '--session', 'tr-x'],
      filter: ['tail', '-n', '5'],
    });
    assert.deepEqual(routeLineOf(`teamrig list 2>&1 | grep -i 'open task'`), { words: ['teamrig', 'list'], filter: ['grep', '-i', 'open task'] });
    assert.deepEqual(routeLineOf('teamrig list|wc -l'), { words: ['teamrig', 'list'], filter: ['wc', '-l'] });
  });

  it('F2: finds no route line where the | is quoted, escaped, doubled, joined to & or not alone', () => {
    for (const line of [
      `teamrig set T1 --note 'a | b'`,
      'teamrig set T1 --note "a | b"',
      'teamrig set T1 --note a\\|b',
      'teamrig list || tail',
      'teamrig list |& tail',
      'teamrig list | tail | sh',
      'teamrig list | tail -n 5 2>&1',
      'teamrig list | tail > out.txt',
      'teamrig list | grep "$HOME"',
      'teamrig list | grep "x"',
      'teamrig list | tail; rm x',
      'teamrig list | tail &',
      'teamrig list | $(echo tail)',
      'teamrig list | tail\nrm x',
      'teamrig list | X=1 tail',
      'teamrig list |',
      '| tail',
      'teamrig list > out.txt | tail',
      '(teamrig list) | tail',
    ]) {
      assert.equal(routeLineOf(line), undefined, line);
    }
  });
});
