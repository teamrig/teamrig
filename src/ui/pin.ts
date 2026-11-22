/**
 * The released UI this teamrig starts (T4761): a constant of the source, so it ships inside the teamrig release that
 * was reviewed with it. It is never read from the team config, which a session can edit: a pin there would let one
 * point the fetch at an archive of its own. The pull request that pins a teamrig-pane release sets it, with a local
 * rebuild at that tag giving the same sha256 (`npm run ui:archive` in teamrig-pane at the tag).
 */
import type { UiPin } from './released.ts';

export const RELEASED_UI: UiPin | undefined = {
  version: '0.80.0',
  url: 'https://github.com/teamrig/teamrig-pane/releases/download/teamrig-pane-v0.80.0/teamrig-ui.json',
  sha256: '8d2d2d024c1656dc8eb64dfdcc1a8c08a31c2ced2aa8dfcac4abaec153271591',
};
