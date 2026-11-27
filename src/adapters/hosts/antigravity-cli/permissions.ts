import {
  isRecord,
  isStringArray,
  type HostPermissions,
  type JsonRecord,
  type PermissionsAnswer,
  type PermissionsReading,
  type TrustedRoutesPlan,
} from '../../../plugin-api/index.ts';

/**
 * Antigravity CLI's permission rules: `permissions.allow` and `permissions.deny` in `settings.json`, using
 * Antigravity's `read_file(<pattern>)` and `command(<target>)` rule syntax, and `toolPermission` for bypass
 * (verified on `agy 1.5.14`).
 */

const PERMISSIONS_KEY = 'permissions';
const ALLOW_KEY = 'allow';
const DENY_KEY = 'deny';
const TOOL_PERMISSION_KEY = 'toolPermission';
const BYPASS_VALUE = 'always-proceed';
const BARE_COMMAND_ALLOW = 'command(*)';
const NO_ROUTES = 'Antigravity CLI has no auto-mode routes';

/**
 * Only exact `command(...)` and root-relative `read_file(...)` rules without `~` or `*`:
 * `agy 1.5.14` did not expand `~` or match `*` / `**` patterns in live runs.
 */
const DENY_LINES: readonly string[] = [
  'read_file(secrets.yaml)',
  'read_file(.env)',
  'command(env)',
  'command(printenv)',
  'command(set)',
  'command(type .env)',
  'command(Get-Content .env)',
  'command(Get-ChildItem env:)',
];

function permissionsOf(settings: JsonRecord): PermissionsAnswer<JsonRecord> {
  const permissions = settings[PERMISSIONS_KEY] ?? {};
  return isRecord(permissions) ? { ok: true, value: permissions } : { ok: false, problem: `${PERMISSIONS_KEY} is not an object` };
}

function allowOf(permissions: JsonRecord): PermissionsAnswer<readonly string[]> {
  const allow = permissions[ALLOW_KEY] ?? [];
  return isStringArray(allow) ? { ok: true, value: allow } : { ok: false, problem: `${PERMISSIONS_KEY}.${ALLOW_KEY} is not a list of texts` };
}

function bypassOf(settings: JsonRecord, allow: PermissionsAnswer<readonly string[]>): string | undefined {
  const parts: string[] = [];
  if (settings[TOOL_PERMISSION_KEY] === BYPASS_VALUE) {
    parts.push(`${TOOL_PERMISSION_KEY} is ${BYPASS_VALUE}`);
  }
  if (allow.ok && allow.value.includes(BARE_COMMAND_ALLOW)) {
    parts.push(`${PERMISSIONS_KEY}.${ALLOW_KEY} contains ${BARE_COMMAND_ALLOW}`);
  }
  return parts.length === 0 ? undefined : parts.join(', ');
}

function read(settings: JsonRecord): PermissionsReading {
  const permissions = settings[PERMISSIONS_KEY];
  const rules = isRecord(permissions) ? permissions : {};
  const list = rules[DENY_KEY];
  const deny = Array.isArray(list) ? list.filter((rule): rule is string => typeof rule === 'string') : [];
  const held = permissionsOf(settings);
  const allow = held.ok ? allowOf(held.value) : held;
  return { allow, deny, bypass: bypassOf(settings, allow) };
}

function writeAllow(settings: JsonRecord, allow: readonly string[]): PermissionsAnswer<JsonRecord> {
  const permissions = permissionsOf(settings);
  if (!permissions.ok) return permissions;
  return { ok: true, value: { ...settings, [PERMISSIONS_KEY]: { ...permissions.value, [ALLOW_KEY]: [...allow] } } };
}

function noRoutes(): PermissionsAnswer<TrustedRoutesPlan> {
  return { ok: false, problem: NO_ROUTES };
}

/** The permissions port of the Antigravity CLI adapter. */
export const antigravityPermissions: HostPermissions = {
  allowSetting: `${PERMISSIONS_KEY}.${ALLOW_KEY}`,
  denySetting: `${PERMISSIONS_KEY}.${DENY_KEY}`,
  routesSetting: 'none (Antigravity CLI has no routes setting)',
  read,
  denyLines: () => [...DENY_LINES],
  writeAllow,
  /** `agy 1.5.14` did not match trailing `*` (`command(echo *)`) in `allow` or `deny`, so prefix allow sync is empty. */
  prefixAllowRules: () => [],
  installRoutes: () => noRoutes(),
  uninstallRoutes: () => noRoutes(),
};
