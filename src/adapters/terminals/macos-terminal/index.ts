import { defineTerminal } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { macosTerminalPort } from './port.ts';

/** The macOS Terminal adapter: it opens a pane as a Terminal window running the pane's command, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: macosTerminalPort(deps) }) });
