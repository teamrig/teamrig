import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loginCallProblem, loginCallsOf, type LoginCall } from './hand-step-login.ts';

const HOME = '/home/someone';
const FENCE = '```';
const block = (lang: string, body: string): string => `${FENCE}${lang}\n${body}\n${FENCE}`;

/** The words of each login call `text` makes as a file of `kind`. */
function wordsOf(text: string, kind: '.ps1' | '.sh' | '.md'): string[] {
  return loginCallsOf(text, kind, HOME).map((call) => call.words);
}

describe('loginCallsOf', () => {
  it('names every gh call in a script, reads and writes alike, in file order', () => {
    const script = ['Write-Host "start"', 'gh api repos/o/n/rulesets', 'gh pr merge 12 --rebase', 'C:\\tools\\gh.exe issue list'].join('\n');
    assert.deepEqual(wordsOf(script, '.ps1'), ['gh api repos/o/n/rulesets', 'gh pr merge 12 --rebase', 'C:\\tools\\gh.exe issue list']);
  });

  it('names each git command that reaches a remote, and passes a local one', () => {
    const script = [
      'git status',
      'git -C /work/app push origin feat/x',
      'git fetch --all',
      'git pull',
      'git clone https://example.com/o/n.git',
      'git ls-remote origin',
      'git remote update',
      'git remote add up https://example.com/o/n.git',
      'git submodule update --init',
      'git log -1',
      'git commit -m "push this"',
    ].join('\n');
    assert.deepEqual(wordsOf(script, '.sh'), [
      'git -C /work/app push origin feat/x',
      'git fetch --all',
      'git pull',
      'git clone https://example.com/o/n.git',
      'git ls-remote origin',
      'git remote update',
      'git submodule update --init',
    ]);
  });

  it('follows a call inside a compound line, a pipe and a nested shell, and a gh-like program known only when it runs', () => {
    assert.deepEqual(wordsOf('if true; then gh repo view o/n | head -1; fi', '.sh'), ['gh repo view o/n']);
    assert.deepEqual(wordsOf('bash -c "git push origin main"', '.sh'), ['git push origin main']);
    assert.deepEqual(wordsOf('"$GH" pr merge 7', '.sh'), ['$GH pr merge 7']);
  });

  it('names each call once, though the file makes it twice', () => {
    assert.deepEqual(wordsOf('gh auth status\ngh auth status\n', '.sh'), ['gh auth status']);
  });

  it('passes a script with no gh and no remote git, and a word gh that is no program', () => {
    assert.deepEqual(wordsOf('Write-Host "gh pr merge is not run here"\nSet-Content -Path C:\\x\\gh.txt -Value 1', '.ps1'), []);
    assert.deepEqual(wordsOf('echo gh push\ngit diff', '.sh'), []);
  });

  it("reads a .md file's fenced blocks by their info string, and a block with no shell word as bash and PowerShell", () => {
    const steps = [
      '# Steps',
      '1. Open the repository settings page and turn on the ruleset.',
      block('powershell', 'PS C:\\work> gh ruleset list'),
      block('console', '$ git push origin main'),
      block('', 'gh secret set KEY'),
      block('cmd', 'gh.exe label list'),
    ].join('\n');
    assert.deepEqual(wordsOf(steps, '.md'), ['gh ruleset list', 'git push origin main', 'gh secret set KEY', 'gh.exe label list']);
  });

  it("reads a .md file's inline code spans outside its blocks, and passes prose and click steps", () => {
    assert.deepEqual(wordsOf('Then run `gh pr view 7` and click Merge.', '.md'), ['gh pr view 7']);
    assert.deepEqual(wordsOf('1. Click Settings, then Rules.\n2. Type `main` in the branch box.\n', '.md'), []);
  });
});

describe('loginCallProblem', () => {
  it('passes a file with no login call', () => {
    assert.equal(loginCallProblem('/t/T1/step.ps1', []), undefined);
  });

  it('names the file, each call, the rule and the route', () => {
    const calls: LoginCall[] = [
      { program: 'gh', words: 'gh pr merge 12' },
      { program: 'git', words: 'git push origin main' },
    ];
    assert.equal(
      loginCallProblem('/t/T1/step.ps1', calls),
      "/t/T1/step.ps1 runs on the human's own login: gh pr merge 12; git push origin main. A hand step never calls the code host's CLI " +
        "or a git command that reaches a remote, which take whatever key the human's keyring holds (core rule 11): hand a repository " +
        'setting as a click path in a .md file, and run a host call or a push yourself after, through teamrig, which uses the key the team saved',
    );
  });
});
