import {
  readFirstOneByOne, type CredentialKeeper, type CredentialRead, type CredentialRemove, type CredentialStore, type FirstRead,
} from '../core/credentials.ts';
import type { ProgramRequest } from '../core/program-runner.ts';
import { tokenName } from '../issues/token-names.ts';

/** The repository owners the specs' GitHub teams list: `acme/web`, `globex/api`. */
export const TEST_OWNERS: readonly string[] = ['acme', 'globex'];

/** The token a store holds for `owner` once `savesTokensFor` saved it. */
export function ownerToken(owner: string): string {
  return `${owner}-token`;
}

/** A store of saved secrets held in memory: empty until a test saves one, and each read and remove is recorded. */
export class FakeCredentials implements CredentialStore, CredentialKeeper {
  readonly label = 'the test store';
  /** The names read, in order. */
  readonly reads: string[] = [];
  /** The names removed, in order. */
  readonly removes: string[] = [];
  private readonly held = new Map<string, CredentialRead>();
  private readonly removeFailures = new Map<string, string>();

  /** From now on, `name` holds `secret`. */
  saves(name: string, secret: string): this {
    this.held.set(name, { kind: 'found', secret });
    return this;
  }

  /** From now on, each owner's key is saved under its own name, holding `ownerToken(owner)`. */
  savesTokensFor(owners: readonly string[]): this {
    for (const owner of owners) {
      this.saves(tokenName(owner), ownerToken(owner));
    }
    return this;
  }

  /** From now on, reading `name` fails with `reason`, as a locked keyring does. */
  failsOn(name: string, reason: string): this {
    this.held.set(name, { kind: 'failed', reason });
    return this;
  }

  /** From now on, removing `name` fails with `reason`. */
  removeFailsOn(name: string, reason: string): this {
    this.removeFailures.set(name, reason);
    return this;
  }

  saveCommand(name: string): string {
    return `save ${name}`;
  }

  saveRequest(name: string): ProgramRequest {
    return { program: 'save', args: [name] };
  }

  async remove(name: string): Promise<CredentialRemove> {
    this.removes.push(name);
    const reason = this.removeFailures.get(name);
    if (reason !== undefined) {
      return { kind: 'failed', reason };
    }
    this.held.delete(name);
    return { kind: 'removed' };
  }

  async read(name: string): Promise<CredentialRead> {
    this.reads.push(name);
    return this.held.get(name) ?? { kind: 'missing' };
  }

  /** Reads one by one, so `reads` shows each name read, and none past the first saved or unreadable one. */
  readFirst(names: readonly string[]): Promise<FirstRead> {
    return readFirstOneByOne((name) => this.read(name), names);
  }
}
