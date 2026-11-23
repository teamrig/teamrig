import { isRecord, stringField, } from "../../../plugin-api/index.js";
/** Some builds double-JSON-encode TargetFile; unwrap one extra string layer when present. */
function decodePath(raw) {
    if (raw === undefined || !raw.startsWith('"') || !raw.endsWith('"')) {
        return raw;
    }
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : raw;
    }
    catch {
        return raw;
    }
}
function shell(name, input, _platform) {
    const command = stringField(input, 'CommandLine');
    // Unproven on Windows: agy runs hook commands via cmd /c, and no live run has confirmed the model's shell dialect yet.
    return { kind: 'shell', name, input, dialect: 'bash', command, readings: command === undefined ? [] : [command] };
}
function wholeWrite(pathKey, contentKey) {
    return (name, input) => {
        const text = stringField(input, contentKey);
        return {
            kind: 'edit',
            name,
            input,
            files: [
                {
                    path: decodePath(stringField(input, pathKey)),
                    texts: text === undefined ? [] : [text],
                    change: text === undefined ? undefined : { kind: 'whole', text },
                },
            ],
        };
    };
}
function replacementOf(input, fromKey, toKey, defaultAll) {
    const from = stringField(input, fromKey);
    const to = stringField(input, toKey);
    if (from === undefined || to === undefined) {
        return undefined;
    }
    const all = typeof input['AllowMultiple'] === 'boolean' ? input['AllowMultiple'] : defaultAll;
    return { from, to, all };
}
function singleEdit(pathKey, fromKey, toKey, defaultAll) {
    return (name, input) => {
        const to = stringField(input, toKey);
        const replacement = replacementOf(input, fromKey, toKey, defaultAll);
        return {
            kind: 'edit',
            name,
            input,
            files: [
                {
                    path: decodePath(stringField(input, pathKey)),
                    texts: to === undefined ? [] : [to],
                    change: replacement === undefined ? undefined : { kind: 'replacements', replacements: [replacement] },
                },
            ],
        };
    };
}
function multiEdit(name, input) {
    const rawChunks = input['ReplacementChunks'];
    const chunks = Array.isArray(rawChunks) ? rawChunks.filter(isRecord) : [];
    const texts = chunks.flatMap((chunk) => stringField(chunk, 'ReplacementContent') ?? []);
    const replacements = chunks.flatMap((chunk) => {
        const one = replacementOf(chunk, 'TargetContent', 'ReplacementContent', false);
        return one === undefined ? [] : [one];
    });
    const change = Array.isArray(rawChunks) && replacements.length === rawChunks.length ? { kind: 'replacements', replacements } : undefined;
    return {
        kind: 'edit',
        name,
        input,
        files: [
            {
                path: decodePath(stringField(input, 'TargetFile')),
                texts,
                change,
            },
        ],
    };
}
function firstQuestionOf(input) {
    const questions = input['questions'];
    const first = Array.isArray(questions) ? questions.find(isRecord) : undefined;
    return first === undefined ? undefined : stringField(first, 'question');
}
const READERS = {
    run_command: shell,
    view_file: (name, input) => ({ kind: 'read', name, input, path: decodePath(stringField(input, 'AbsolutePath')) }),
    read_file: (name, input) => ({ kind: 'read', name, input, path: decodePath(stringField(input, 'Path')) }),
    write_to_file: wholeWrite('TargetFile', 'CodeContent'),
    write_file: wholeWrite('Path', 'Content'),
    replace_file_content: singleEdit('TargetFile', 'TargetContent', 'ReplacementContent', false),
    edit_file: singleEdit('Path', 'Target', 'Replacement', true),
    multi_replace_file_content: multiEdit,
    grep_search: (name, input) => ({
        kind: 'search',
        name,
        input,
        path: stringField(input, 'SearchPath'),
        glob: undefined,
        showsContent: true,
    }),
    find_by_name: (name, input) => ({
        kind: 'search',
        name,
        input,
        path: stringField(input, 'SearchDirectory'),
        glob: stringField(input, 'Pattern'),
        showsContent: false,
    }),
    list_dir: (name, input) => ({
        kind: 'search',
        name,
        input,
        path: stringField(input, 'DirectoryPath'),
        glob: undefined,
        showsContent: false,
    }),
    read_url_content: (name, input) => ({ kind: 'web', name, input, url: stringField(input, 'Url') }),
    search_web: (name, input) => ({ kind: 'web', name, input, url: undefined }),
    invoke_subagent: (name, input) => ({ kind: 'helper', name, input, type: stringField(input, 'TypeName') }),
    swarm: (name, input) => ({ kind: 'helper', name, input, type: stringField(input, 'action') }),
    send_message: (name, input) => ({
        kind: 'message',
        name,
        input,
        to: stringField(input, 'Recipient')?.trim() || undefined,
        text: stringField(input, 'Message'),
    }),
    ask_question: (name, input) => ({ kind: 'ask', name, input, asks: 'question', question: firstQuestionOf(input) }),
    schedule: (name, input) => ({ kind: 'schedule', name, input }),
};
export function isAntigravityToolName(name) {
    return Object.hasOwn(READERS, name);
}
/** The tool-call port of Antigravity on `platform`. */
export function toolCallShape(platform) {
    return {
        normalize: (name, input) => (isAntigravityToolName(name) ? READERS[name](name, input, platform) : { kind: 'other', name, input }),
    };
}
