import type { Support, TerminalDeclaration } from '../../../plugin-api/index.ts';

/** No row carries a proof yet: a proof is the record of a live run on the operating system it names. */
const SUPPORTED: Support = { kind: 'supported', proofs: [] };

/** A headless pane has no window: nothing to bring forward, name or show a title in. */
const NO_WINDOW: Support = { kind: 'unsupported', notice: 'a headless session has no window' };

/** teamrig ends and restarts a session through its own launcher, in a tab or not; the terminal has no call for it. */
const BY_LAUNCHER: Support = { kind: 'unsupported', notice: "teamrig's launcher ends and restarts the session itself" };

const NO_STATE: Support = { kind: 'unsupported', notice: 'a headless session cannot tell whether it is idle' };

/**
 * What teamrig does for a headless session, the opt-in for sessions no one watches: on Windows a pane is its command
 * under `conhost --headless`, elsewhere a detached tmux session named after its title.
 */
export const declaration: TerminalDeclaration = {
  apiVersion: '0.1.0',
  id: 'headless',
  name: 'headless',
  manifest: {
    'pane.open': SUPPORTED,
    'pane.window': NO_WINDOW,
    'pane.focus': NO_WINDOW,
    'pane.close': BY_LAUNCHER,
    'pane.restart': BY_LAUNCHER,
    'pane.rename': NO_WINDOW,
    'pane.deliver': NO_STATE,
    'pane.is-idle': NO_STATE,
    'pane.list': { kind: 'unsupported', notice: 'teamrig does not list headless sessions through the terminal yet' },
    'pane.sees-draft': { kind: 'unsupported', notice: 'a headless session has no input anyone types into' },
  },
};
