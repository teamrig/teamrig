import { SecretShapes } from "../core/secret-shapes.js";
import { DEFAULT_SECRET_COMMANDS } from "./commands.js";
import { DEFAULT_SECRET_ENV_NAMES, SecretNames } from "./names.js";
import { DEFAULT_SECRET_PATHS, SecretPaths } from "./paths.js";
import { PatternList } from "./pattern-list.js";
import { readKeyText } from "./public-key.js";
/**
 * The globs `host` names. A `!glob` among them is left out: a host adds secret files, and only a team's own `!glob`
 * keeps a file readable, so no host can open what the defaults or another host keeps.
 */
function hostGlobs(host) {
    return host.secretFiles().filter((glob) => !glob.startsWith('!'));
}
/**
 * The defaults, then the team's own globs, names and commands; file names ignore case on Windows and macOS hosts.
 * The secret files of `host` come between the default globs and the team's: the last glob that matches decides, so
 * a team's `!glob` can still keep one of the host's readable. They are not optional and not a list, so no caller
 * leaves them out or hands the team's patterns in their place.
 * `secretPatterns` are the team's `register.secretPatterns`, added to the write-time shapes.
 */
export function secretRulesOf(config, home, platform, host, secretPatterns = []) {
    const ignoreCase = platform === 'win32' || platform === 'darwin';
    return {
        paths: new SecretPaths([...DEFAULT_SECRET_PATHS, ...hostGlobs(host), ...config.paths], home, ignoreCase, readKeyText),
        names: new SecretNames([...DEFAULT_SECRET_ENV_NAMES, ...config.envNames]),
        commands: new PatternList([...DEFAULT_SECRET_COMMANDS, ...config.commands]),
        shapes: new SecretShapes(secretPatterns),
        home,
    };
}
