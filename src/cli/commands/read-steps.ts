import { SHIPPED_CONFIG_FORMAT } from '../../config/migrate.ts';
import { SecretScanner } from '../../core/secrets.ts';
import { stepsBody } from '../../interface/index.ts';
import { pendingSteps } from '../../steps/pending.ts';
import { stampsOf, type DocumentSource, type ReadScope } from './read-source.ts';

/**
 * `steps`: the steps teamrig needs its person to take, as `teamrig steps` lists them, for a reader to show with a
 * button that types the step's command in the person's tab. It reads the team's config file, and the config format
 * this teamrig writes, which is in the revision: an update that brings a new format makes a step pending with no file
 * changed, and must not be answered `unchanged`.
 */
export function stepsSource(scope: ReadScope): DocumentSource {
  const { runtime, kit, config } = scope;
  return {
    async parts() {
      return {
        document: 'steps',
        args: [
          ['team', kit.paths.team],
          ['format', String((runtime.configFormat ?? SHIPPED_CONFIG_FORMAT).version)],
        ],
        stamps: await stampsOf(runtime, [kit.load.path]),
      };
    },
    async build() {
      const body = stepsBody({ steps: pendingSteps({ config: kit.load }), shapes: new SecretScanner(config.register.secretPatterns) });
      return { body, problems: [] };
    },
  };
}
