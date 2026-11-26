import { isAbsolute } from 'node:path';
import { runTerminalKit } from '../../composition/terminal-kit.ts';
import { osOf } from '../../conformance/index.ts';
import type { ParsedArgs } from '../args.ts';
import { UsageError } from '../args.ts';
import { EXIT, type CliRuntime, type ExitCode } from '../runtime.ts';

const USAGE = 'usage: teamrig conformance terminal --program <absolute path> --sha256 <hex> [--args <a,b>]';
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * `teamrig conformance terminal`: runs the terminal contract's cases on an outside terminal program, the one at
 * `--program` whose bytes hash to `--sha256`, over the terminal protocol. Each case gets a new fake terminal of the
 * program's own (kit mode), then the program must serve no kit request outside kit mode. Prints a PASS or FAIL line
 * per case, the cases this operating system skips, and each kit request served outside kit mode; exit 0 only when every
 * case passed and none leaked.
 */
export async function conformanceTerminal(args: ParsedArgs, runtime: Pick<CliRuntime, 'out' | 'fileBytes' | 'terminalPrograms' | 'env' | 'platform' | 'newId'>): Promise<ExitCode> {
  const program = args.flags.get('program');
  const sha256 = args.flags.get('sha256');
  if (program === undefined || sha256 === undefined || args.positionals.length > 0) {
    throw new UsageError(USAGE);
  }
  if (!isAbsolute(program)) {
    throw new UsageError(`${USAGE}\n--program must be an absolute path, not ${program}`);
  }
  if (!SHA256.test(sha256)) {
    throw new UsageError(`${USAGE}\n--sha256 must be 64 lowercase hex characters`);
  }
  const report = await runTerminalKit({
    pin: { path: program, sha256, args: (args.flags.get('args') ?? '').split(',').filter((word) => word !== '') },
    read: async (path) => await runtime.fileBytes.read(path),
    programs: runtime.terminalPrograms,
    env: runtime.env,
    os: osOf(runtime.platform),
    runId: runtime.newId(),
  });
  for (const one of report.cases) {
    runtime.out.stdout(one.outcome.kind === 'passed' ? `PASS ${one.id}` : `FAIL ${one.id}: ${one.outcome.reason}`);
  }
  for (const id of report.skipped) {
    runtime.out.stdout(`SKIP ${id}: not on this operating system`);
  }
  for (const leak of report.leaks) {
    runtime.out.stdout(`LEAK ${leak.method}: served outside kit mode: ${leak.answer}`);
  }
  const failed = report.cases.filter((one) => one.outcome.kind !== 'passed').length;
  runtime.out.stdout(`${report.cases.length - failed} of ${report.cases.length} cases passed, ${report.leaks.length} kit request(s) served outside kit mode`);
  return failed === 0 && report.leaks.length === 0 ? EXIT.ok : EXIT.failed;
}
