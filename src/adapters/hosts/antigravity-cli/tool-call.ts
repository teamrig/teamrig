import {
  isRecord,
  stringField,
  type HostDeps,
  type JsonRecord,
  type TextChange,
  type TextReplacement,
  type ToolCall,
  type ToolCallShape,
} from '../../../plugin-api/index.ts';

/** Reads one Antigravity tool's arguments into the call the core knows. */
type Reader = (name: string, input: JsonRecord, platform: HostDeps['platform']) => ToolCall;

/** Some builds double-JSON-encode TargetFile; unwrap one extra string layer when present. */
function decodePath(raw: string | undefined): string | undefined {
  if (raw === undefined || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw;
  }
}

function shell(name: string, input: JsonRecord, _platform: HostDeps['platform']): ToolCall {
  const command = stringField(input, 'CommandLine');
  // Unproven on Windows: agy runs hook commands via cmd /c, and no live run has confirmed the model's shell dialect yet.
  return { kind: 'shell', name, input, dialect: 'bash', command, readings: command === undefined ? [] : [command] };
}

function wholeWrite(pathKey: string, contentKey: string): Reader {
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

function replacementOf(input: JsonRecord, fromKey: string, toKey: string, defaultAll: boolean): TextReplacement | undefined {
  const from = stringField(input, fromKey);
  const to = stringField(input, toKey);
  if (from === undefined || to === undefined) {
    return undefined;
  }
  const all = typeof input['AllowMultiple'] === 'boolean' ? input['AllowMultiple'] : defaultAll;
  return { from, to, all };
}

function singleEdit(pathKey: string, fromKey: string, toKey: string, defaultAll: boolean): Reader {
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

function multiEdit(name: string, input: JsonRecord): ToolCall {
  const rawChunks: unknown = input['ReplacementChunks'];
  const chunks = Array.isArray(rawChunks) ? rawChunks.filter(isRecord) : [];
  const texts = chunks.flatMap((chunk) => stringField(chunk, 'ReplacementContent') ?? []);
  const replacements = chunks.flatMap((chunk) => {
    const one = replacementOf(chunk, 'TargetContent', 'ReplacementContent', false);
    return one === undefined ? [] : [one];
  });
  const change: TextChange | undefined = Array.isArray(rawChunks) && replacements.length === rawChunks.length ? { kind: 'replacements', replacements } : undefined;
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

function firstQuestionOf(input: JsonRecord): string | undefined {
  const questions: unknown = input['questions'];
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
} as const satisfies Readonly<Record<string, Reader>>;

/** A tool agy names in its hook input's `toolCall.name`, which this port reads. */
export type AntigravityToolName = keyof typeof READERS;

export function isAntigravityToolName(name: string): name is AntigravityToolName {
  return Object.hasOwn(READERS, name);
}

/** The tool-call port of Antigravity on `platform`. */
export function toolCallShape(platform: HostDeps['platform']): ToolCallShape {
  return {
    normalize: (name, input) => (isAntigravityToolName(name) ? READERS[name](name, input, platform) : { kind: 'other', name, input }),
  };
}
