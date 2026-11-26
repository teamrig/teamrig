import { defineTerminal } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { headlessPort } from "./port.js";
/** The headless adapter: it opens a pane with no window (conhost --headless on Windows, a detached tmux session elsewhere), and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: headlessPort(deps) }) });
