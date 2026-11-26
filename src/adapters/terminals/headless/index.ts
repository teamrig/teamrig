import { defineTerminal } from '../../../plugin-api/index.ts';
import { declaration } from './declaration.ts';
import { headlessPort } from './port.ts';

/** The headless adapter: it opens a pane with no window (conhost --headless on Windows, a detached tmux session elsewhere), and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: headlessPort(deps) }) });
