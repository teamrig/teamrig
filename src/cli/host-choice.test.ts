import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HostSource, ShippedHosts } from '../composition/host-ports.ts';
import { NO_PATHS_HOST, NO_SESSION_HOST, SHIPPED_HOST } from '../testing/host.ts';
import { UsageError } from './args.ts';
import { chooseHost, type StartingHosts, type TeamHosts } from './host-choice.ts';
import { RefusedError } from './runtime.ts';

const ONE: ShippedHosts = { 'claude-code': SHIPPED_HOST };
const TWO: ShippedHosts = { 'claude-code': SHIPPED_HOST, 'antigravity-cli': NO_PATHS_HOST };

/** The process's default host stands apart from every shipped one, so a spec sees which of them was taken. */
function starting(shippedHosts: ShippedHosts, host: HostSource = NO_SESSION_HOST): StartingHosts {
  return { host, shippedHosts };
}

/** A team whose config lists `hosts` (undefined: no config loads), counting how often it is read. */
class Team {
  reads = 0;
  private readonly hosts: readonly string[] | undefined;
  constructor(hosts: readonly string[] | undefined) {
    this.hosts = hosts;
  }
  readonly list: TeamHosts = async () => {
    this.reads += 1;
    return this.hosts;
  };
}

describe('chooseHost', () => {
  it('takes the shipped host the command line names', async () => {
    assert.equal(await chooseHost('list', 'antigravity-cli', starting(TWO), new Team(['claude-code', 'antigravity-cli']).list), NO_PATHS_HOST);
  });

  it('refuses as a usage error an id no shipped adapter has, naming those that ship', async () => {
    await assert.rejects(chooseHost('list', 'nope', starting(TWO), new Team(undefined).list), (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.equal(error.message, '--host nope names no host teamrig ships; it ships claude-code, antigravity-cli');
      assert.equal(error.command, 'list');
      return true;
    });
  });

  it("refuses a shipped host the team's hosts do not list", async () => {
    await assert.rejects(chooseHost('list', 'antigravity-cli', starting(TWO), new Team(['claude-code']).list), (error: unknown) => {
      assert.ok(error instanceof RefusedError);
      assert.match(error.message, /^--host antigravity-cli is not one of the team's hosts \(claude-code\)/);
      return true;
    });
  });

  it('takes a named shipped host when no team config loads', async () => {
    assert.equal(await chooseHost('doctor', 'antigravity-cli', starting(TWO), new Team(undefined).list), NO_PATHS_HOST);
  });

  it("takes the first of the team's hosts when none is named", async () => {
    assert.equal(await chooseHost('list', undefined, starting(TWO), new Team(['antigravity-cli', 'claude-code']).list), NO_PATHS_HOST);
  });

  it('keeps the default host when none is named and no team config loads', async () => {
    assert.equal(await chooseHost('list', undefined, starting(TWO), new Team(undefined).list), NO_SESSION_HOST);
  });

  it('never reads the team config while one host ships, named or not', async () => {
    const team = new Team(['claude-code']);
    assert.equal(await chooseHost('hook stop', 'claude-code', starting(ONE), team.list), SHIPPED_HOST);
    assert.equal(await chooseHost('hook stop', undefined, starting(ONE), team.list), NO_SESSION_HOST);
    assert.equal(team.reads, 0);
  });
});
