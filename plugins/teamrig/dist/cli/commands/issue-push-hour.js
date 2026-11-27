import { errorMessage } from "../../core/guards.js";
import { hourSent, minuteOf, parsePushHour, pushHourText, shiftWrites } from "../../issues/push-hour.js";
import { autoPushWrites, hourPushWrites, PUSH_WRITES_PER_HOUR, PUSH_WRITES_PER_RUN } from "../../issues/status-push.js";
import { fileLockOf } from "../file-locks.js";
import { githubState } from "../github-state.js";
/** Reads the hour's count, sets the run's limit from it and reserves that limit in the count. */
export async function reserveHour(runtime, kit, config) {
    const probeSeconds = config.github.probeSeconds;
    const share = autoPushWrites(probeSeconds);
    try {
        return await fileLockOf(runtime, githubState(kit.paths).syncLock, config.lock).run(async () => {
            const read = parsePushHour(await runtime.files.read(githubState(kit.paths).pushHour));
            const now = runtime.clock.now();
            const minute = minuteOf(now);
            const limit = read.kind === 'read' ? readLimit(probeSeconds, hourSent(read.hour, now)) : { writesPerRun: share, lines: [`NOTE status push: the hour's write count could not be read (${read.reason}), so this run sends at most the even share of ${share}; its own writes start a new count`] };
            await runtime.files.write(githubState(kit.paths).pushHour, pushHourText(shiftWrites(read.kind === 'read' ? read.hour : [], now, minute, limit.writesPerRun)));
            return { ...limit, reserved: { minute, writes: limit.writesPerRun } };
        });
    }
    catch (error) {
        return { writesPerRun: share, lines: [`NOTE status push: the hour's write count could not be kept (${errorMessage(error)}), so this run sends at most the even share of ${share}`], reserved: undefined };
    }
}
function readLimit(probeSeconds, sent) {
    const writesPerRun = hourPushWrites(probeSeconds, sent);
    const limited = probeSeconds > 0 && writesPerRun < PUSH_WRITES_PER_RUN;
    return { writesPerRun, lines: limited ? [`NOTE status push: ${sent} write(s) went out in the last hour, of ${PUSH_WRITES_PER_HOUR}, so this run sends at most ${writesPerRun}`] : [] };
}
/** Settles the run's reservation to the `writes` it counted; a failure leaves the hour counted at the reservation. */
export async function settleHour(runtime, kit, config, limit, writes) {
    const reserved = limit.reserved;
    if (reserved === undefined || writes === reserved.writes) {
        return [];
    }
    try {
        await fileLockOf(runtime, githubState(kit.paths).syncLock, config.lock).run(async () => {
            const read = parsePushHour(await runtime.files.read(githubState(kit.paths).pushHour));
            const now = runtime.clock.now();
            // A count damaged since the reservation is replaced by this run's writes alone.
            const hour = read.kind === 'read' ? shiftWrites(read.hour, now, reserved.minute, writes - reserved.writes) : shiftWrites([], now, reserved.minute, writes);
            await runtime.files.write(githubState(kit.paths).pushHour, pushHourText(hour));
        });
        return [];
    }
    catch (error) {
        return [`NOTE status push: the hour's write count was not settled (${errorMessage(error)}), so it counts this run at its limit of ${reserved.writes} until that minute is an hour old`];
    }
}
