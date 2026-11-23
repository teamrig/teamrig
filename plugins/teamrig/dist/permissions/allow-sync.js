import { REGISTER_COMMANDS } from "../automode/lines.js";
import { KIT_NAME } from "../core/home.js";
import { KeepList, normalRule } from "./allow-rules.js";
import { READ_ROUTE_COMMANDS } from "./route-read.js";
/**
 * teamrig's own allow rules in the host's settings (T5070 S4, security verdict T5156): `automode install` puts one host
 * prefix rule per synced command in the person's allow setting. A host prefix rule approves the command with any
 * arguments before the host's classifier, and cannot check what the S1 hook route checks (the launcher, refused flags,
 * flag values starting `-`). So the synced set is the S1 route's commands (the register and read routes) less
 * {@link SYNC_EXCLUDED}: what is left reads or writes the team's own files whatever its arguments, and no other CLI
 * command starts with its words (a rule for `budget` would also approve `budget lift`). Specs hold the set to that; a
 * change to either list goes to the security reviewer.
 *
 * A sync owns only the rules it wrote, as its record names them (src/cli/allow-record.ts): it takes out an owned rule
 * that is no longer synced, and never one the person wrote, even one equal to a synced rule.
 */
/** The S1 route's commands, as the CLI names them: the register route's, then the read route's. */
export const ROUTE_COMMANDS = [...new Set([...REGISTER_COMMANDS, ...READ_ROUTE_COMMANDS.keys()])];
/** The route's commands that get no allow rule, each with why: they stay on the S1 hook route alone. */
export const SYNC_EXCLUDED = new Map([
    ['add', 'with --issue it posts a public GitHub issue, a flag the hook route refuses and a prefix rule cannot'],
    ['sessions', 'with --project it reads a folder the caller names and prints from it'],
    ['setup scan', 'with --project it reads a folder the caller names and prints from it'],
    ['commits check', 'its --base value reaches git log, where a value starting - is a flag'],
    ['secrets pushed', 'its remote reaches git, where a value starting - is a flag'],
    ['budget', 'its rule would approve budget lift, cut, extra, setup and rollup'],
    ['burst', 'its rule would approve burst start and end'],
    ['restore', 'its rule would approve restore install, uninstall, run, resume and check'],
    ['rules', 'its rule would approve rules clear, forget and keep'],
    ['schedule', 'its rule would approve schedule set'],
    ['pipeline', 'its rule would approve pipeline freeze, unfreeze and front'],
    ['decisions', 'its rule would approve decisions asked'],
    ['steps', 'its rule would approve steps run'],
]);
/** The commands whose allow rules install syncs. */
export const ALLOW_COMMANDS = ROUTE_COMMANDS.filter((command) => !SYNC_EXCLUDED.has(command));
/** The host's rules for these commands, each run as the kit's own program word. */
export function allowRulesOf(permissions, commands) {
    return commands.flatMap((command) => permissions.prefixAllowRules(`${KIT_NAME} ${command}`));
}
/**
 * What the file lacks of the synced rules, and the stale ones of `owned` it still holds. A person's rule of the same
 * reach counts as there (a legacy `:*` form, a leading `MSYS_NO_PATHCONV=1`), as the keep-list reads rules.
 */
export function allowRulesProbe(permissions, settings, owned, commands = ALLOW_COMMANDS) {
    const standing = standingOf(permissions, settings, owned, commands);
    if (!standing.ok) {
        return standing;
    }
    const { missing, stale } = standing.value;
    return { ok: true, value: { ok: missing.length === 0 && stale.length === 0, missing, stale } };
}
/** The settings with the stale rules out and the missing ones after the person's own, every other rule in its place. */
export function planAllowSync(permissions, settings, owned, commands = ALLOW_COMMANDS) {
    const standing = standingOf(permissions, settings, owned, commands);
    if (!standing.ok) {
        return standing;
    }
    const { allow, missing, stale, kept } = standing.value;
    const nextOwned = [...kept, ...missing];
    if (missing.length === 0 && stale.length === 0) {
        return { ok: true, value: { settings: undefined, removed: [], added: [], owned: nextOwned } };
    }
    const written = permissions.writeAllow(settings, [...allow.filter((rule) => !stale.includes(rule)), ...missing]);
    return written.ok ? { ok: true, value: { settings: written.value, removed: stale, added: missing, owned: nextOwned } } : written;
}
function standingOf(permissions, settings, owned, commands) {
    const allow = permissions.read(settings).allow;
    if (!allow.ok) {
        return allow;
    }
    const wanted = allowRulesOf(permissions, commands);
    const present = new Set(allow.value.map(normalRule));
    const missing = wanted.filter((rule) => !present.has(normalRule(rule)));
    const held = owned.filter((rule) => allow.value.includes(rule));
    const stale = held.filter((rule) => !wanted.includes(rule));
    const kept = held.filter((rule) => wanted.includes(rule));
    return { ok: true, value: { allow: allow.value, missing, stale, kept } };
}
/**
 * The team's keep-list with the synced rules on it, so `permissions trim` never takes out a rule install puts back,
 * and the doctor never counts one as wide.
 */
export function keepListOf(permissions, keepAllow) {
    return new KeepList([...keepAllow, ...allowRulesOf(permissions, ALLOW_COMMANDS)]);
}
