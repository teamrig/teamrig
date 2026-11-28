/**
 * The team config keys only the owner changes, by path: each is a permission or an owner gate (core rule 6). Who
 * holds a role or a service role; what is owner- or security-gated; who the owner is in the register; the asks, route
 * and read-only allow rules; the exec review; the alerts; whose GitHub logins count as ours; each connector's settings,
 * which say what outside tool it reaches and how; the guards; and each repository's merge, deploy and check commands,
 * which teamrig runs with the full environment; and the keys that prove the owner's own acts. A key's entries and
 * fields are under it. One list for both readers (#1470): the config guard refuses a session's write of any of them
 * (service-role-guard.ts), and `teamrig config get` shows each as owner-gated (settings.ts), so it never shows a key
 * the guard refuses as editable.
 */
export const OWNER_GATED_KEYS: readonly (readonly string[])[] = [
  ['serviceRoles'],
  ['roles'],
  ['ownerGates'],
  ['securityGates'],
  ['register', 'ownerSource'],
  ['prompts'],
  ['readonlyShell'],
  ['exec'],
  ['alerts'],
  ['github', 'owners'],
  ['connectors'],
  ['delivery', 'repos'],
  ['delivery', 'passEnv'],
  ['permissions'],
  ['pushGuard'],
  ['secretGuard'],
  ['packageGuard'],
  ['dbWriteGuard'],
  ['commitGuard'],
  // Which keys prove the owner's own acts, and how: a session that could change them could sign as the owner (T4758).
  ['owner', 'proof'],
];

/**
 * Keys this teamrig no longer reads that an older teamrig still acts on, so the config guard alone keeps refusing a
 * session's write of them: after a rollback, the older teamrig would act on the value a session wrote. `teamrig config
 * get` does not list them, as they are no setting of this teamrig. `ui.path` named the UI entry script an older
 * `teamrig ui` runs in the person's own terminal, outside every guard (T5129).
 */
export const RETIRED_GUARDED_KEYS: readonly (readonly string[])[] = [['ui', 'path']];

/** Every key the config guard refuses a session's write of: the owner-gated keys and the retired ones. */
export const CONFIG_GUARD_KEYS: readonly (readonly string[])[] = [...OWNER_GATED_KEYS, ...RETIRED_GUARDED_KEYS];
