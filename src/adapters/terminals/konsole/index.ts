import { defineTerminal } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { konsolePort } from './port.ts';

/** The Konsole adapter: it opens a pane as a Konsole tab running the pane's command, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: konsolePort(deps) }) });
