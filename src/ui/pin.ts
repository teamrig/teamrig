/**
 * The released UI this teamrig starts (T4761): a constant of the source, so it ships inside the teamrig release that
 * was reviewed with it. It is never read from the team config, which a session can edit: a pin there would let one
 * point the fetch at an archive of its own. The pull request that pins a teamrig-pane release sets it, with a local
 * rebuild at that tag giving the same sha256 (`npm run ui:archive` in teamrig-pane at the tag).
 */
import type { UiPin } from './released.ts';

export const RELEASED_UI: UiPin | undefined = {
  version: '0.86.0',
  url: 'https://github.com/teamrig/teamrig-pane/releases/download/teamrig-pane-v0.86.0/teamrig-ui.json',
  sha256: '662c2a31c02e1883a39d7c8dd02d4161af56cce3db2332f0d6827789f571315f',
};
