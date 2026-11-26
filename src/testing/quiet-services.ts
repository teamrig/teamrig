import type { CliRuntime } from '../cli/runtime.ts';
import { referenceTerminal } from '../conformance/index.ts';
import { FakeCredentials, TEST_OWNERS } from './fake-credentials.ts';
import { FakeGh } from './fake-gh.ts';
import { FakeHttp } from './fake-http.ts';
import { FakePackageRegistry } from './fake-package-registry.ts';
import { FakeTerminal } from './fake-terminal.ts';
import { FakeWebhook } from './fake-webhook.ts';
import { programOverGh } from './program-over-gh.ts';
import { terminalProgram } from './terminal-protocol-host.ts';

/**
 * The outside tools a run reaches: a connector's program and HTTP API, saved keys, the package registry, the webhook,
 * the pinned terminal program the kit checks.
 */
export type ServicesWorld = Pick<CliRuntime, 'run' | 'terminalPrograms' | 'credentials' | 'keys' | 'http' | 'packageRegistry' | 'webhook'>;

/**
 * Outside tools when a run does not care about them: the one program a connector's tool runner runs is gh, which sees
 * no repository, a key is saved for each of TEST_OWNERS, no person types at the terminal, no outside API answers, the
 * package registry holds no package, and a pinned terminal program is the reference terminal over the protocol, staged
 * nowhere.
 */
export function quietServices(): ServicesWorld {
  const credentials = new FakeCredentials().savesTokensFor(TEST_OWNERS);
  return {
    run: programOverGh(new FakeGh()),
    terminalPrograms: { stage: async (_bytes, sha256, name) => `/staged/${sha256}/${name}`, run: terminalProgram(referenceTerminal).run },
    credentials,
    keys: { keeper: credentials, terminal: new FakeTerminal() },
    http: new FakeHttp(),
    packageRegistry: new FakePackageRegistry(),
    webhook: new FakeWebhook(),
  };
}
