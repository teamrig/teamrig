import { defineTerminal } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { gnomeTerminalPort } from './port.ts';

/** The GNOME Terminal adapter: it opens a pane as a GNOME Terminal tab running the pane's command, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: gnomeTerminalPort(deps) }) });
