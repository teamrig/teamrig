import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_TABLE } from '../cli/run.ts';
import type { KitContext } from './route-kit.ts';
import { LANDING_COMMANDS, matchesLanding, type LandingContext } from './route-pr.ts';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

/** `tr-x` is bound to the tab and has a leader; `lead` leads the root team; any other name is not the tab's. */
class Landings implements KitContext, LandingContext {
  readonly cli = COMMAND_TABLE;
  readonly asked: (string | undefined)[] = [];
  private readonly ownProgram: string;
  constructor(ownProgram = 'teamrig') {
    this.ownProgram = ownProgram;
  }
  readonly ownClient = async (word: string): Promise<boolean> => word === this.ownProgram;
  readonly approversOf = async (named: string | undefined): Promise<readonly string[]> => {
    this.asked.push(named);
    return named === undefined || named === 'tr-x' ? ['lead'] : [];
  };
}

const lands = async (line: string, context: Landings = new Landings()): Promise<boolean> => matchesLanding(line.split(' '), context);

describe('matchesLanding', () => {
  it('C2: takes approve and merge with a pull target and a full head, with --session and --check in any order', async () => {
    assert.deepEqual(LANDING_COMMANDS, ['pr approve', 'pr merge']);
    for (const line of [
      `teamrig pr approve acme/web#7 --head ${HEAD}`,
      `teamrig pr merge acme/web#7 --head ${HEAD} --session tr-x`,
      `teamrig pr merge --check --session tr-x acme/web#7 --head ${HEAD}`,
      `teamrig pr approve --head ${HEAD} acme/web#7 --check`,
    ]) {
      assert.equal(await lands(line), true, line);
    }
  });

  it('C1: asks who clears the named session, else the environment, and takes no landing that no leader clears', async () => {
    const context = new Landings();
    assert.equal(await lands(`teamrig pr approve acme/web#7 --head ${HEAD} --session tr-x`, context), true);
    assert.equal(await lands(`teamrig pr approve acme/web#7 --head ${HEAD}`, context), true);
    assert.deepEqual(context.asked, ['tr-x', undefined]);
    assert.equal(await lands(`teamrig pr merge acme/web#7 --head ${HEAD} --session lead`), false, 'the root team lead');
    assert.equal(await lands(`teamrig pr merge acme/web#7 --head ${HEAD} --session bravo`), false, "another session's name");
  });

  it('C2: takes no missing or short head, an extra flag, a second or missing positional, or a target that is no pull', async () => {
    for (const line of [
      'teamrig pr approve acme/web#7',
      'teamrig pr approve acme/web#7 --head 0123456',
      `teamrig pr approve acme/web#7 --head ${HEAD.toUpperCase()}`,
      `teamrig pr approve acme/web#7 --head ${HEAD} --body x`,
      `teamrig pr approve acme/web#7 acme/web#8 --head ${HEAD}`,
      `teamrig pr approve --head ${HEAD}`,
      `teamrig pr approve web --head ${HEAD}`,
      `teamrig pr approve acme/web#7 --head ${HEAD} --help`,
    ]) {
      assert.equal(await lands(line), false, line);
    }
  });

  it("takes no landing through another program than this install's teamrig", async () => {
    assert.equal(await lands(`teamrig pr approve acme/web#7 --head ${HEAD}`, new Landings('C:/elsewhere/teamrig')), false);
  });

  it('asks no one about a line that is no landing', async () => {
    const context = new Landings();
    assert.equal(await lands('teamrig merge --session tr-x', context), false);
    assert.equal(await lands('teamrig pr approve acme/web#7', context), false);
    assert.deepEqual(context.asked, []);
  });
});
