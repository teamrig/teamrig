import { defineTerminal } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { macosTerminalPort } from "./port.js";
/** The macOS Terminal adapter: it opens a pane as a Terminal window running the pane's command, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: macosTerminalPort(deps) }) });
