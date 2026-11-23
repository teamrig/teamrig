import { defineTerminal } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { windowsTerminalPort } from "./port.js";
/** The Windows Terminal adapter: it opens a pane as a titled tab, in a named window too, and brings that tab forward. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: windowsTerminalPort(deps) }) });
