import { defineTerminal } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { konsolePort } from "./port.js";
/** The Konsole adapter: it opens a pane as a Konsole tab running the pane's command, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: konsolePort(deps) }) });
