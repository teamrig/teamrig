import { withoutCredentials } from "../core/child-env.js";
import { ENV } from "../core/home.js";
import { envKey, pathList } from "../core/path-search.js";
/** Variables that make Claude Code a teamrig session: its id, its team, and that `launch` runs it. */
const TEAMRIG_SESSION_VARIABLES = [ENV.session, ENV.team, ENV.launched];
/** `env` without the variables `names` lists, names compared without case, as Windows reads them. */
function withoutVariables(env, names) {
    const left = new Set(names.map((name) => name.toUpperCase()));
    return Object.fromEntries(Object.entries(env).filter(([name]) => !left.has(name.toUpperCase())));
}
/**
 * PATH without the host's plugin `bin` folders (isCacheBin). The opener's PATH holds those of the plugin versions its
 * own session started with. Claude Code adds a session's own at the end of its Bash tool's PATH, and adds them again
 * after a plugin update and /reload-plugins, so an inherited one would sit ahead of them and keep every Bash call in
 * the new session on the opener's version for the life of its process (T494). Every other entry stays as it was.
 */
function withoutPluginBins(env, platform, isCacheBin) {
    const key = envKey(env, 'PATH', platform);
    const value = key === undefined ? undefined : env[key];
    if (key === undefined || value === undefined) {
        return env;
    }
    const delimiter = platform === 'win32' ? ';' : ':';
    // pathList reads one entry the way a PATH search does (trimmed, unquoted); the kept entries keep their own spelling.
    const kept = value.split(delimiter).filter((entry) => !pathList(entry, delimiter).some(isCacheBin));
    return { ...env, [key]: kept.join(delimiter) };
}
/**
 * The environment a session starts in: the session and team set, so every hook and `teamrig` command in it knows who
 * it is, and the opener's own plugin `bin` folders and `hostSession` left out: the variables a host sets for a
 * session's own tools (the host port's `childEnv.session`), which would make the new session look nested in the
 * opener's and let it reach what the host keeps for that one.
 */
export function sessionEnv(env, identity, platform, isCacheBin, hostSession) {
    return {
        ...withoutVariables(withoutPluginBins(env, platform, isCacheBin), hostSession),
        [ENV.session]: identity.id,
        [ENV.team]: identity.team,
        ...(identity.home === undefined ? {} : { [ENV.home]: identity.home }),
    };
}
/**
 * A team session's environment without the credential variables (core/child-env.ts), but `login`, the host's own
 * (the host port's `childEnv.login`), as the session is the host's program, and those `pass` (`delivery.passEnv`)
 * names: the session's tools run the team's code. A session outside any team (plainSessionEnv) keeps its environment,
 * as no team config names what it needs.
 */
export function sessionCredentialFree(env, pass, login) {
    return withoutCredentials(env, [...login, ...pass]);
}
/**
 * The environment a session outside any team resumes in: neither the opener's host session variables (`hostSession`,
 * as for sessionEnv) nor its teamrig session, so the resumed session is not taken for the opener, nor its plugin
 * `bin` folders; the kit home set when it is not the default.
 */
export function plainSessionEnv(env, home, platform, isCacheBin, hostSession) {
    return {
        ...withoutVariables(withoutPluginBins(env, platform, isCacheBin), [...hostSession, ...TEAMRIG_SESSION_VARIABLES]),
        ...(home === undefined ? {} : { [ENV.home]: home }),
    };
}
