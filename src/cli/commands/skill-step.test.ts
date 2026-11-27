import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS } from '../../features/steps.ts';
import { CliHarness, TEAM, type CliResult } from '../../testing/cli-harness.ts';
import { NO_SESSION_HOST, SHIPPED_HOST, shippedHost } from '../../testing/host.ts';
import { EXIT } from '../runtime.ts';
import { stepLines } from './skill-step.ts';

const GITHUB_TEAM = { ...TEAM, github: { repos: ['owner/name'] } };

function printed(result: CliResult): readonly string[] {
  assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
  return result.stdout;
}

describe('teamrig skills step', () => {
  it("prints the running host's text of a host step, headed by its name", async () => {
    const lines = printed(await new CliHarness().run(['skills', 'step', 'host.rename']));
    assert.equal(lines[0], 'Claude Code:');
    assert.match(lines[1] ?? '', /`\/rename <new name>`/);
    assert.equal(lines.length, 2);
  });

  it('prints the text of the host --host names, not the default host, on a team listing it (T5862)', async () => {
    const kit = new CliHarness({ ...TEAM, hosts: ['claude-code', 'codex-cli'] });
    // Two distinct port sources, so the run's host tells which shipped adapter --host picked.
    const options = { shippedHosts: { 'claude-code': shippedHost(SHIPPED_HOST), 'codex-cli': shippedHost(NO_SESSION_HOST) } };
    const codex = printed(await kit.run(['skills', 'step', 'host.hooks-file', '--host', 'codex-cli'], options));
    assert.equal(codex[0], 'Codex CLI:');
    const claude = printed(await kit.run(['skills', 'step', 'host.hooks-file', '--host', 'claude-code'], options));
    assert.deepEqual(claude, ['No host adapter in use here serves host.hooks-file; Codex CLI, Antigravity CLI would.', STEPS['host.hooks-file'].fallback]);
  });

  it('prints the text of each connector the team config uses', async () => {
    const lines = printed(await new CliHarness(GITHUB_TEAM).run(['skills', 'step', 'codehost.fetch-outside-change']));
    assert.equal(lines[0], 'GitHub:');
    assert.match(lines[1] ?? '', /git fetch origin pull\/<number>\/head/);
  });

  it("picks the connector by --for's ref prefix, whatever the team config uses", async () => {
    const lines = printed(await new CliHarness().run(['skills', 'step', 'tracker.link-child', '--for', 'gh:owner/name#12']));
    assert.equal(lines[0], 'GitHub:');
  });

  it('prints the neutral fallback, and who would serve the step, when no connector in use serves it', async () => {
    const lines = printed(await new CliHarness({ ...TEAM, connectors: { jira: { site: 'https://example.atlassian.net' } } }).run(['skills', 'step', 'tracker.link-child']));
    assert.deepEqual(lines, ['No connector adapter in use here serves tracker.link-child; GitHub would.', STEPS['tracker.link-child'].fallback]);
  });

  it('refuses a step id the registry lacks, a second id, a ref no connector prefixes, and --for on a host step', async () => {
    const kit = new CliHarness(GITHUB_TEAM);
    for (const argv of [
      ['skills', 'step', 'tracker.link'],
      ['skills', 'step'],
      ['skills', 'step', 'host.rename', 'host.slim-setup'],
      ['skills', 'step', 'tracker.link-child', '--for', 'xx:1'],
      ['skills', 'step', 'host.rename', '--for', 'gh:owner/name#12'],
    ]) {
      const result = await kit.run(argv);
      assert.equal(result.code, EXIT.usage, argv.join(' '));
    }
  });
});

describe('the lines of a step', () => {
  const github = { id: 'github', name: 'GitHub', text: 'Link it on GitHub.' };
  const gitlab = { id: 'gitlab', name: 'GitLab', text: 'Link it on GitLab.' };
  const jira = { id: 'jira', name: 'Jira', text: undefined };

  it('heads each serving text by its name, a blank line between two', () => {
    assert.deepEqual(stepLines('tracker.link-child', [github, jira, gitlab], [github, jira, gitlab]), ['GitHub:', 'Link it on GitHub.', '', 'GitLab:', 'Link it on GitLab.']);
  });

  it('falls back with no adapter naming itself when none anywhere serves the step', () => {
    assert.deepEqual(stepLines('tracker.link-child', [jira], [jira]), ['No connector adapter in use here serves tracker.link-child.', STEPS['tracker.link-child'].fallback]);
  });
});
