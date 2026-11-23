import { defineTerminal } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { gnomeTerminalPort } from "./port.js";
/** The GNOME Terminal adapter: it opens a pane as a GNOME Terminal tab running the pane's command, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: gnomeTerminalPort(deps) }) });
