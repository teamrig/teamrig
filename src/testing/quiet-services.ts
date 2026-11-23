import type { CliRuntime } from '../cli/runtime.ts';
import { FakeCredentials, TEST_OWNERS } from './fake-credentials.ts';
import { FakeGh } from './fake-gh.ts';
import { FakeHttp } from './fake-http.ts';
import { FakePackageRegistry } from './fake-package-registry.ts';
import { FakeTerminal } from './fake-terminal.ts';
import { FakeWebhook } from './fake-webhook.ts';
import { programOverGh } from './program-over-gh.ts';

/** The outside tools a run reaches: a connector's program and HTTP API, saved keys, the package registry, the webhook. */
export type ServicesWorld = Pick<CliRuntime, 'run' | 'credentials' | 'keys' | 'http' | 'packageRegistry' | 'webhook'>;

/**
 * Outside tools when a run does not care about them: the one program a connector's tool runner runs is gh, which sees
 * no repository, a key is saved for each of TEST_OWNERS, no person types at the terminal, no outside API answers and
 * the package registry holds no package.
 */
export function quietServices(): ServicesWorld {
  const credentials = new FakeCredentials().savesTokensFor(TEST_OWNERS);
  return {
    run: programOverGh(new FakeGh()),
    credentials,
    keys: { keeper: credentials, terminal: new FakeTerminal() },
    http: new FakeHttp(),
    packageRegistry: new FakePackageRegistry(),
    webhook: new FakeWebhook(),
  };
}
