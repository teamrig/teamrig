import { join } from 'node:path';
import { protocolTerminal } from "../adapters/terminals/protocol/client.js";
import { kitLeaks, kitWorld } from "../adapters/terminals/protocol/kit.js";
import { pinnedTransport, PROTOCOL_OUTPUT_CAP_BYTES, PROTOCOL_TIME_LIMIT_MS } from "../adapters/terminals/protocol/spawn.js";
import { privateStage } from "../adapters/terminals/protocol/stage.js";
import { bind, runCases, TERMINAL_CONTRACT } from "../conformance/index.js";
import { nodeProgramRunner } from "../core/program-runner.js";
/** The real ones: copies staged under `<kitHome>/terminal-programs`, each run held to the protocol's time and output limits. */
export function nodeTerminalPrograms(kitHome, pid) {
    return {
        stage: privateStage(join(kitHome, 'terminal-programs'), String(pid)),
        run: nodeProgramRunner(PROTOCOL_TIME_LIMIT_MS, PROTOCOL_OUTPUT_CAP_BYTES),
    };
}
/**
 * Runs the terminal contract on an outside program over the protocol. The program runs once per request, so each case
 * gets a kit world of a new name (`KIT_MODE_ENV`), which the program keeps apart from every other. Last, the program
 * runs without kit mode and must serve no kit request.
 */
export async function runTerminalKit(run) {
    const ports = { read: run.read, stage: run.programs.stage, run: run.programs.run, env: run.env };
    let made = 0;
    const bound = bind({
        contract: TERMINAL_CONTRACT,
        make: () => {
            made += 1;
            const transport = pinnedTransport(run.pin, ports, { kitWorld: `${run.runId}-${made}` });
            return { port: protocolTerminal(transport), world: kitWorld(transport) };
        },
    });
    const { runs, skipped } = casesOn(bound.cases, run.os);
    return { cases: await runCases(runs), skipped, leaks: await kitLeaks(pinnedTransport(run.pin, ports)) };
}
/** The cases that run on `os` (every one when it is undefined), and the ids of the rest. */
export function casesOn(cases, os) {
    const runsOn = (one) => os === undefined || one.os.includes(os);
    return { runs: cases.filter(runsOn), skipped: cases.filter((one) => !runsOn(one)).map((one) => one.id) };
}
