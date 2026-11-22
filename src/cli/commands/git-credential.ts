import { gitKeys } from '../../composition/git-keys.ts';
import { CREDENTIAL_QUIT, credentialOperationOf, parseCredentialRequest } from '../../core/git-credential.ts';
import type { ParsedArgs } from '../args.ts';
import { UsageError } from '../args.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';

/**
 * `teamrig git-credential <get|store|erase>`: git's credential helper for https to github.com. `get` answers with the
 * key saved for the repository owner git names in the path, read from the credential store alone (no environment
 * token stands in), or `quit=1` with a stderr line saying why, so git asks no later helper or prompt. `store` and
 * `erase` keep nothing and change nothing: the keys are only teamrig's to save.
 */
export async function gitCredential(args: ParsedArgs, runtime: Pick<CliRuntime, 'readStdin' | 'out' | 'credentials'>): Promise<ExitCode> {
  const operation = credentialOperationOf(args.positionals[0]);
  if (operation === undefined || args.positionals.length !== 1) {
    throw new UsageError('usage: teamrig git-credential <get|store|erase> (git runs it as a credential helper)');
  }
  const request = await runtime.readStdin();
  if (operation !== 'get') {
    return EXIT.ok;
  }
  const parsed = parseCredentialRequest(request);
  const answer =
    parsed.kind === 'refused'
      ? { stdout: CREDENTIAL_QUIT, note: `teamrig git-credential: no key given: ${parsed.why}` }
      : await gitKeys(runtime.credentials).answer(parsed.ask);
  for (const line of answer.stdout.split('\n')) {
    if (line !== '') {
      runtime.out.stdout(line);
    }
  }
  if (answer.note !== undefined) {
    runtime.out.stderr(answer.note);
  }
  return EXIT.ok;
}
