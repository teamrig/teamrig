import { changedFrame, DOCUMENTS, helloFrame, isDocumentName, movedDocuments } from "../../interface/index.js";
import { UsageError } from "../args.js";
import { EXIT, RefusedError } from "../runtime.js";
import { documentFlagsOf, revisionOf, scopeFlagsOf, sourcesOf } from "./read.js";
import { ReachedFolders } from "../../core/reached-folders.js";
import { resolveKitHome } from "../../core/home.js";
import { KIT_VERSION } from "../../core/version.js";
import { CurrentVersionReader, newerVersion } from "../../kit/newer-current.js";
/** How long the follower waits between two looks at its documents' files; every change inside one wait is one frame. */
export const EVENTS_PASS_MS = 1_000;
/** The longest the follower goes without a look while its folders tell of no change, for a change they missed. */
export const EVENTS_FALLBACK_MS = 30_000;
const DOCUMENTS_FORM = `--documents takes <document>[,<document>...]; the documents are ${DOCUMENTS.join(', ')}`;
/**
 * `teamrig events --json`: the events side of the public interface (docs/design/public-interface.md), as a follower
 * a program starts and reads. Each frame is one JSON line on stdout and nothing else is ever written there: `hello`
 * first, naming every followed document with its revision, then a `changed` frame naming the documents whose
 * revision moved, at most one each {@link EVENTS_PASS_MS}. A frame names documents and revisions only, so the reader
 * runs `read --unless` for what it wants of them. A refusal goes to stderr before the first frame, as `read`'s does.
 *
 * It looks only at the stamps `read` hashes a revision from: it folds no register, builds no document, and writes no
 * file, no mark and no lock. It ends with exit 0 once the process that started it is gone or its stdout's reader is;
 * the reader's end is seen only at a frame's write, so with nothing changing it is the starter's end that stops it.
 * It also ends with exit 0, an `ENDED` line on stderr, once `<kit home>/current` moves to a version newer than its own
 * (T5813): a follower left on an old version after an update ran on for days. A version current already named at its
 * start ends nothing, so a reader whose CLI lags the kit (a plugin cache not yet updated) is never ended in a loop;
 * the reader starts it again, from wherever it finds the CLI then.
 *
 * The scope is opened once: a config edit moves every revision, but the sessions and paths the follower holds are
 * the ones it started with until it is started again. A revision it then names may differ from the one `read`
 * answers, which costs the reader one full answer and nothing else.
 */
export async function events(args, runtime) {
    const request = requestOf(args, runtime);
    const reached = new ReachedFolders(runtime.files);
    let sources;
    try {
        ({ sources } = await sourcesOf(request, { ...runtime, files: reached }));
    }
    catch (error) {
        if (error instanceof RefusedError) {
            runtime.out.stderr(`REFUSED ${error.message}`);
            return EXIT.refused;
        }
        throw error;
    }
    const watching = await runtime.starters.watch();
    const ended = () => watching.stop.aborted || runtime.out.closed?.aborted === true;
    const looks = new Looks(runtime, reached, sources, resolveKitHome(runtime.env, runtime.userHome));
    try {
        const first = await looks.look();
        let held = first.revisions;
        runtime.out.stdout(JSON.stringify(helloFrame(held)));
        while (!ended()) {
            await runtime.sleep(EVENTS_PASS_MS);
            if (ended()) {
                break;
            }
            if (!looks.due()) {
                continue;
            }
            const { revisions: now, current } = await looks.look();
            const superseding = current === first.current ? undefined : newerVersion(current, KIT_VERSION);
            if (superseding !== undefined) {
                runtime.out.stderr(`ENDED teamrig ${superseding} is installed, and this follower ran ${KIT_VERSION}; start it again`);
                return EXIT.ok;
            }
            const frame = changedFrame(movedDocuments(held, now));
            if (frame !== undefined) {
                runtime.out.stdout(JSON.stringify(frame));
            }
            held = now;
        }
        return EXIT.ok;
    }
    finally {
        looks.close();
        watching.close();
    }
}
/**
 * When the follower looks at its files again (T5758). A look stamps each file every document reads, which over a
 * tree of teams is hundreds of files, so an idle follower looks only once a watched folder tells of a change, or
 * every second while any folder it reads cannot be watched, and in any case every {@link EVENTS_FALLBACK_MS}, for a
 * change the system did not tell of. The folders are those the last look reached, watched again whenever they differ.
 */
class Looks {
    runtime;
    reached;
    sources;
    current;
    watch;
    folders = [];
    signalled = false;
    lastLookAt = 0;
    constructor(runtime, reached, sources, kitHome) {
        this.runtime = runtime;
        this.reached = reached;
        this.sources = sources;
        this.current = new CurrentVersionReader(reached, kitHome);
    }
    /** Whether a look is due now. */
    due() {
        const unwatched = this.watch === undefined || this.watch.unwatched().length > 0;
        return this.signalled || unwatched || this.runtime.clock.now() - this.lastLookAt >= EVENTS_FALLBACK_MS;
    }
    /**
     * Every document's revision now and the version `<kit home>/current` names, watching the folders this look reached
     * when they differ from the last look's: the kit home's among them, so an install wakes the follower as a change does.
     */
    async look() {
        this.signalled = false;
        const { value, folders } = await this.reached.record(async () => ({
            revisions: await revisionsOf(this.sources),
            current: await this.current.version(),
        }));
        this.lastLookAt = this.runtime.clock.now();
        if (this.watch === undefined || !sameFolders(folders, this.folders)) {
            this.watch?.close();
            this.folders = folders;
            this.watch = this.runtime.folderSignals.watch(folders, () => {
                this.signalled = true;
            });
            // A change after this look stamped its file but before its folder was watched would go untold: look once more.
            this.signalled = true;
        }
        return value;
    }
    close() {
        this.watch?.close();
        this.watch = undefined;
    }
}
function sameFolders(one, other) {
    return one.length === other.length && one.every((folder, index) => folder === other[index]);
}
function requestOf(args, runtime) {
    const [extra] = args.positionals;
    if (extra !== undefined) {
        throw new UsageError(`unexpected "${extra}": events names its documents with --documents`);
    }
    if (!args.switches.has('json')) {
        throw new UsageError('events answers only as JSON in interface 1: add --json');
    }
    const documents = documentsOf(args.flags.get('documents'), args.flags.has('task'));
    return { documents, ...scopeFlagsOf(args, runtime.env), ...documentFlagsOf(args, documents), unless: new Map(), speaks: undefined };
}
/**
 * `--documents`: the documents to follow, each once. With the flag left out, every document of the interface, but
 * `history` only when `--task` names its task: `history` is one task's, so with no task it would refuse the whole run.
 */
function documentsOf(typed, taskNamed) {
    if (typed === undefined) {
        return taskNamed ? DOCUMENTS : DOCUMENTS.filter((name) => name !== 'history');
    }
    const documents = [];
    for (const name of typed.split(',')) {
        if (!isDocumentName(name)) {
            throw new UsageError(`${DOCUMENTS_FORM}; got "${name}"`);
        }
        if (documents.includes(name)) {
            throw new UsageError(`--documents names ${name} twice`);
        }
        documents.push(name);
    }
    return documents;
}
/**
 * Each followed document with its revision now. A document whose files could not be stamped (a permission refused,
 * a disk gone) is named with no revision, which differs from any it held: the reader then reads it and is told why.
 */
async function revisionsOf(sources) {
    const revisions = [];
    for (const [document, source] of sources) {
        revisions.push({ document, revision: await revisionOrNull(source) });
    }
    return revisions;
}
async function revisionOrNull(source) {
    try {
        return revisionOf(await source.parts());
    }
    catch {
        return null;
    }
}
