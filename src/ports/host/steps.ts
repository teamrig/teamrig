/**
 * The steps a host's person types, named in teamrig's notices: in a session (load a newly installed plugin, end the
 * session, run a plugin's command) and in a terminal (reopen a session, update a plugin, update the host). The core
 * words the notice; the port gives only the step, so a notice tells each host's person what to type there.
 */
export interface HostSteps {
  /** What a person types in a session to load the plugin versions installed since it started. */
  readonly reloadPlugins: string;
  /** What a person types in a session to end it. */
  readonly exit: string;
  /** What a person types in a session to run the plugin's command `name`, before its arguments. */
  pluginCommand(name: string): string;
  /** The terminal command that reopens the host's session `id` with its history. */
  resume(id: string): string;
  /** The terminal command that updates `plugin` from `marketplace`. */
  updatePlugin(plugin: string, marketplace: string): string;
  /** The terminal command that updates the host itself. */
  readonly updateHost: string;
}
