import { dirname, normalize } from 'node:path';
/**
 * `Files` over another `Files` that, while recording, keeps each folder a call reaches into: the folder of a file it
 * stamps, sizes, dates or reads, and the folder it lists. A change to any of those files shows as a change in one of
 * those folders, which is what a folder watch can tell (core/folder-signals.ts). Every call passes through.
 */
export class ReachedFolders {
    inner;
    recording;
    constructor(inner) {
        this.inner = inner;
    }
    /** Runs `work`, and gives its answer with the folders its calls reached, sorted and each once. */
    async record(work) {
        const folders = new Set();
        this.recording = folders;
        try {
            const value = await work();
            return { value, folders: [...folders].sort() };
        }
        finally {
            this.recording = undefined;
        }
    }
    read(path) {
        return this.inner.read(this.fileIn(path));
    }
    readTail(path, maxBytes) {
        return this.inner.readTail(this.fileIn(path), maxBytes);
    }
    readHead(path, maxBytes) {
        return this.inner.readHead(this.fileIn(path), maxBytes);
    }
    append(path, text) {
        return this.inner.append(path, text);
    }
    write(path, text) {
        return this.inner.write(path, text);
    }
    createExclusive(path, text) {
        return this.inner.createExclusive(path, text);
    }
    list(dir) {
        return this.inner.list(this.folder(dir));
    }
    makeFolder(path) {
        return this.inner.makeFolder(path);
    }
    remove(path) {
        return this.inner.remove(path);
    }
    move(from, to) {
        return this.inner.move(from, to);
    }
    stamp(path) {
        return this.inner.stamp(this.fileIn(path));
    }
    modifiedAt(path) {
        return this.inner.modifiedAt(this.fileIn(path));
    }
    size(path) {
        return this.inner.size(this.fileIn(path));
    }
    realPath(path) {
        return this.inner.realPath(this.fileIn(path));
    }
    isPlainFile(path) {
        return this.inner.isPlainFile(this.fileIn(path));
    }
    // Kept in the platform's form: teamrig names one folder with either separator, and each form would be a watch.
    fileIn(path) {
        this.recording?.add(normalize(dirname(path)));
        return path;
    }
    folder(path) {
        this.recording?.add(normalize(path));
        return path;
    }
}
