import type { ProgramRunner } from '../core/program-runner.ts';
import { GH_PROGRAM, type GhRunner } from '../adapters/connectors/github/gh.ts';

/**
 * A spec's way to stand a `gh` fake in for the program runner a CLI run hands its connector adapters. The GitHub
 * adapter reaches `gh` through that runner and nothing else, so a spec that answers `gh` calls with a GhRunner
 * (FakeGh) passes it here, and each run of `gh` the adapter makes lands in it.
 */

/** A program runner was asked for a program other than the one it stands for. */
export class NotGhError extends Error {
  override readonly name = 'NotGhError';

  constructor(program: string) {
    super(`this runner runs ${GH_PROGRAM} alone, not ${program}`);
  }
}

/** Whether a request starts gh: by its name, or by a path to it, as `teamrig gh` runs it (`/usr/bin/gh`, `C:\Tools\gh.exe`). */
function isGh(program: string): boolean {
  const last = program.split(/[\\/]/u).at(-1) ?? '';
  return last === GH_PROGRAM || last.toLowerCase() === `${GH_PROGRAM}.exe`;
}

/**
 * `gh` as a program runner: a request for `gh`, by name or path, goes to it, in the request's environment, an empty one when it sets
 * none; a request for any other program rejects with NotGhError, so a spec sees an adapter that runs anything else.
 */
export function programOverGh(gh: GhRunner): ProgramRunner {
  return (request) => (isGh(request.program) ? gh.run({ args: request.args, env: request.env ?? {} }) : Promise.reject(new NotGhError(request.program)));
}
