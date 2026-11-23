import { SHIPPED_CONFIG_FORMAT } from "../../config/migrate.js";
import { SecretScanner } from "../../core/secrets.js";
import { stepsBody } from "../../interface/index.js";
import { pendingSteps } from "../../steps/pending.js";
import { stampsOf } from "./read-source.js";
/**
 * `steps`: the steps teamrig needs its person to take, as `teamrig steps` lists them, for a reader to show with a
 * button that types the step's command in the person's tab. It reads the team's config file, and the config format
 * this teamrig writes, which is in the revision: an update that brings a new format makes a step pending with no file
 * changed, and must not be answered `unchanged`.
 */
export function stepsSource(scope) {
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
