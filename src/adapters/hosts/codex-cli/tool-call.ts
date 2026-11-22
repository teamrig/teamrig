import { stringField, type EditedFile, type JsonRecord, type ToolCall, type ToolCallShape } from '../../../plugin-api/index.ts';
import { readApplyPatch, type PatchOperation } from './apply-patch.ts';

/**
 * Codex CLI's tool calls as the core reads them. Codex names two tools in its hook input: `Bash`, whose
 * `tool_input.command` is the line its shell runs, and `apply_patch`, whose `tool_input.command` is the whole patch
 * text (Codex 0.170.0, `core/src/hook_runtime.rs`). Every other tool, MCP tools too, is `other`.
 *
 * Codex runs a `Bash` line through PowerShell on Windows (`-NoProfile -Command`, cmd.exe only when no PowerShell is
 * found), and elsewhere through the user's shell, else bash or zsh, else `/bin/sh` (`shell-command/src/shell_detect.rs`,
 * `core/src/shell.rs`). It hands the line to that shell as one argument, with no Windows command line between that
 * rewrites it, so the line as written is the only reading.
 */

/** The shell a `Bash` line runs in on `platform`, by the dialect a guard parses it with. */
function shellCall(name: string, input: JsonRecord, platform: NodeJS.Platform): ToolCall {
  const command = stringField(input, 'command');
  const dialect = platform === 'win32' ? 'powershell' : 'bash';
  return { kind: 'shell', name, input, dialect, command, readings: command === undefined ? [] : [command] };
}

/**
 * The files one patch operation touches. Codex writes an added file's text as each `+` line followed by a newline
 * (`apply-patch/src/streaming_parser.rs`), over any file already there; an update's added lines say what it writes
 * but not the text it leaves, nor does a delete or a move.
 */
function filesOf(operation: PatchOperation): readonly EditedFile[] {
  switch (operation.kind) {
    case 'add': {
      const text = operation.addedLines.map((line) => `${line}\n`).join('');
      return [{ path: operation.path, texts: [text], change: { kind: 'whole', text } }];
    }
    case 'delete':
      return [{ path: operation.path, texts: [], change: undefined }];
    case 'update': {
      const texts = operation.addedLines.length === 0 ? [] : [operation.addedLines.join('\n')];
      const source: EditedFile = { path: operation.path, texts, change: undefined };
      return operation.moveTo === undefined ? [source] : [source, { path: operation.moveTo, texts, change: undefined }];
    }
  }
}

/**
 * An `apply_patch` call as the files it touches. A patch Codex cannot read either is one file with no path, its whole
 * text what it writes: Codex refuses to apply it, and a guard still reads its text.
 */
function patchCall(name: string, input: JsonRecord): ToolCall {
  const patch = stringField(input, 'command');
  const reading = patch === undefined ? undefined : readApplyPatch(patch);
  const files: readonly EditedFile[] =
    reading?.ok === true && reading.operations.length > 0 ? reading.operations.flatMap(filesOf) : [{ path: undefined, texts: patch === undefined ? [] : [patch], change: undefined }];
  return { kind: 'edit', name, input, files };
}

/** The tool-call port of Codex CLI on `platform`, which decides the shell a `Bash` line runs in. */
export function toolCallShape(platform: NodeJS.Platform): ToolCallShape {
  return {
    normalize: (name, input) => {
      switch (name) {
        case 'Bash':
          return shellCall(name, input, platform);
        case 'apply_patch':
          return patchCall(name, input);
        default:
          return { kind: 'other', name, input };
      }
    },
  };
}
