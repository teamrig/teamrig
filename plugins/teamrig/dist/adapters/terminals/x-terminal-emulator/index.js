import { defineTerminal } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { xTerminalEmulatorPort } from "./port.js";
/** The x-terminal-emulator adapter: it opens a pane as a window of the system's terminal, titled by the pane's title, and serves nothing else. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: xTerminalEmulatorPort(deps) }) });
