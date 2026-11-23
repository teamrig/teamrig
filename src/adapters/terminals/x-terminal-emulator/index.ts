import { defineTerminal } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { xTerminalEmulatorPort } from './port.ts';

/** The x-terminal-emulator adapter: it opens a pane as a window of the system's terminal, titled by the pane's title, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: xTerminalEmulatorPort(deps) }) });
