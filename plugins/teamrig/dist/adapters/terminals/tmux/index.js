import { defineTerminal } from "../../../plugin-api/index.js";
import { declaration } from "./declaration.js";
import { tmuxPort } from "./port.js";
/** The tmux adapter: it opens a pane as a tmux window named by its title, and brings that window forward. */
export default defineTerminal({ declaration, create: (deps) => ({ terminal: tmuxPort(deps) }) });
