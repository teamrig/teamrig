import { defineTerminal } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { tmuxPort } from './port.ts';

/** The tmux adapter: it opens a pane as a tmux window named by its title, and brings that window forward. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: tmuxPort(deps) }) });
