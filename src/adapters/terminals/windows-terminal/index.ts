import { defineTerminal } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { windowsTerminalPort } from './port.ts';

/** The Windows Terminal adapter: it opens a pane as a titled tab, in a named window too, and brings that tab forward. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: windowsTerminalPort(deps) }) });
