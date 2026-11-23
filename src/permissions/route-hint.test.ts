import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_TABLE } from '../cli/run.ts';
import { ALLOW_COMMANDS } from './allow-sync.ts';
import { KIT_SHAPES, matchesKit, type KitContext, type KitShape } from './route-kit.ts';
import { routeLineOf } from './route-line.ts';
import { LANDING_COMMANDS, matchesLanding, type LandingContext } from './route-pr.ts';
import { ROUTE_FORMS, routeHintOf, type AllowRulesFor } from './route-hint.ts';

const RULES: AllowRulesFor = (command) => [`Bash(teamrig ${command} *)`, `PowerShell(teamrig ${command} *)`];
const CONTEXT: KitContext & LandingContext = { cli: COMMAND_TABLE, ownClient: () => Promise.resolve(true), approversOf: () => Promise.resolve(['lead']) };

/** The sample value each placeholder of a route form takes, longest first so `<name>` never eats part of a target. */
const SAMPLES: readonly (readonly [string, string])[] = [
  ['<owner>/<name>#<number>', 'acme/app#12'],
  ['<40-hex sha>', 'a'.repeat(40)],
  ['<request.json>', 'request.json'],
  ['<path>', '/w/feature'],
  ['<id>', 'alpha'],
  ['<name>', 'api'],
];

/** `form` with every optional part taken and every placeholder filled, as the words a session would write. */
function filled(form: string): readonly string[] {
  const text = SAMPLES.reduce((line, [placeholder, value]) => line.replaceAll(placeholder, value), form).replaceAll(/[[\]]/gu, '');
  assert.doesNotMatch(text, /[<>]/u, `a placeholder of "${form}" has no sample`);
  return text.split(' ');
}

/** The narrower route shapes by the command each takes. */
const SHAPE_OF = new Map<string, KitShape>(Object.values(KIT_SHAPES).flatMap((shape) => (shape === KIT_SHAPES.register ? [] : shape.commands.map((command) => [command, shape] as const))));

describe('ROUTE_FORMS', () => {
  it("names every narrower route's command, and no other", () => {
    assert.deepEqual([...ROUTE_FORMS.keys()].sort(), [...SHAPE_OF.keys(), ...LANDING_COMMANDS].sort());
  });

  it("is, with every option taken, a line its route runs, so the hint never names a form the route refuses", async () => {
    for (const [command, form] of ROUTE_FORMS) {
      const words = filled(form);
      const shape = SHAPE_OF.get(command);
      const matches = shape === undefined ? await matchesLanding(words, CONTEXT) : await matchesKit(shape, words, CONTEXT);
      assert.ok(matches, form);
    }
  });

  it('is never a synced command, whose hint names its allow rule instead', () => {
    assert.deepEqual([...ROUTE_FORMS.keys()].filter((command) => ALLOW_COMMANDS.includes(command)), []);
  });
});

describe('routeHintOf', () => {
  const hint = (line: string): string | undefined => routeHintOf(line, COMMAND_TABLE, RULES);

  it("names a synced command's host rules and the install that adds them", () => {
    assert.ok(ALLOW_COMMANDS.includes('list'));
    assert.equal(
      hint('teamrig list --session alpha'),
      '`teamrig list` reads or writes only the team\'s own files. It runs with no prompt once the person runs `teamrig automode install --yes`, which adds the host rule `Bash(teamrig list *)`, `PowerShell(teamrig list *)`; until then, as one plain line of its own.',
    );
  });

  it('says what else a line must be: a bare program word and only a read-only filter after a pipe', () => {
    assert.match(hint('./teamrig list') ?? '', /; until then, as one plain line of its own, with the program word a bare `teamrig`\.$/u);
    assert.match(hint('teamrig list | sort') ?? '', /, piped into nothing but one read-only filter \(head, tail, grep[^)]*\) with no file\.$/u);
    assert.equal(routeLineOf('teamrig list | head -5')?.filter?.[0], 'head');
    assert.match(hint('teamrig list | head -5') ?? '', /; until then, as one plain line of its own\.$/u);
  });

  it("names a narrower route's exact form, and for a landing the leader's approval it needs", () => {
    assert.equal(
      hint('teamrig merge --session alpha'),
      `\`teamrig merge\` runs with no prompt only as one plain line of its own written \`${ROUTE_FORMS.get('merge') ?? ''}\`, through this install's own teamrig.`,
    );
    assert.match(hint('C:/bin/teamrig.cmd worktree remove /w/x --base main') ?? '', /`teamrig worktree remove <path> .*`, with the program word a bare `teamrig`, through/u);
    assert.match(hint(`teamrig pr merge acme/app#12 --head ${'a'.repeat(40)}`) ?? '', /, and only for a head your leader approved, from the tab bound to your session, through/u);
  });

  it('gives no hint for a command with neither a route nor a synced rule, a line the CLI refuses, or no teamrig line', () => {
    for (const line of [
      'teamrig add --title x --issue',
      'teamrig exec approve r1',
      'teamrig budget',
      'teamrig list --bogus',
      'teamrig list -- x',
      'teamrig merge --help',
      'node x.js list',
      'rm x',
      'teamrig list && rm x',
      'teamrig list > out.txt',
    ]) {
      assert.equal(hint(line), undefined, line);
    }
  });
});
