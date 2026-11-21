import { join } from 'node:path';
import { ADAPTER_ID } from "../plugin-api/index.js";
/** The folder under the team's state that holds one folder per connector. */
const CONNECTORS_FOLDER = 'connectors';
/**
 * The state paths of the connector of an id. The id becomes a folder name, so one that is no adapter id (a `..`, a
 * separator, an upper-case letter that would name the same folder twice on a case-blind disk) is refused here, whoever
 * the caller is, rather than trusted to have been checked where the config was read.
 */
export function connectorState(paths, id) {
    if (!ADAPTER_ID.test(id)) {
        throw new Error(`no connector state for ${JSON.stringify(id)}: a connector id is lower-case words joined by -`);
    }
    const dir = join(paths.state, CONNECTORS_FOLDER, id);
    return {
        dir,
        sync: join(dir, 'sync.json'),
        syncLock: join(dir, 'sync.lock'),
        ci: join(dir, 'ci'),
        pushHour: join(dir, 'push-hour.json'),
        clocks: join(dir, 'clocks.json'),
        watch: join(dir, 'watch.json'),
        watchLock: join(dir, 'watch.lock'),
        follows: join(dir, 'follows.json'),
        claims: join(dir, 'claims.json'),
    };
}
