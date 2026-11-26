import type { DbClientVocabulary, DbWriteGuardConfig } from '../config/types.ts';

/**
 * The writes a piece of database code names: document-shell code, Node code that loads a client the team names, key-value
 * commands and SQL. Each scan returns the distinct names it found, in the order it first met them; none means the
 * text only reads, as far as its words show.
 */

/** Document-shell methods that change stored data, `db.c.update(...)` and the older `insert`, `remove` and `save` too. */
const DOCUMENT_SHELL_WRITE =
  /\.\s*(insert(?:One|Many)?|update(?:One|Many)?|replaceOne|delete(?:One|Many)|remove|save|findOneAnd(?:Update|Replace|Delete)|findAndModify|bulkWrite|drop(?:Database|Indexes|Index|SearchIndex)?|renameCollection|createIndex(?:es)?|createCollection|runCommand|adminCommand)\s*\(/g;

/**
 * Document-client calls that change stored data. The shell's older `insert`, `update` and `remove`, and its
 * `runCommand`, are left out: Node code shares those names (a hash's `update`, a list's `remove`).
 */
const DOCUMENT_CLIENT_WRITE =
  /\.\s*(insert(?:One|Many)|update(?:One|Many)|replaceOne|delete(?:One|Many)|save|findOneAnd(?:Update|Replace|Delete|Remove)|findByIdAnd(?:Update|Replace|Delete|Remove)|bulkWrite|drop(?:Database|Indexes|Index|SearchIndex|Collection)?|renameCollection|createIndex(?:es)?|createCollection)\s*\(/g;

/** A model's `Model.create(...)`, but not `Object.create(...)`. */
const MODEL_CREATE = /(?<!\bObject)\.\s*(create)\s*\(/g;

/** Aggregation stages that write their result to a collection. */
const WRITE_STAGE = /\$(out|merge)\b/g;

/**
 * Key-value commands that change stored data. A Node client names them in any case (`hset`, `hSet`), a command-line
 * client in any case too, so the set holds them upper case.
 */
const KEY_VALUE_WRITES: ReadonlySet<string> = new Set([
  'APPEND', 'BITOP', 'BLMOVE', 'COPY', 'DECR', 'DECRBY', 'DEL', 'EVAL', 'EVALSHA', 'EXPIRE', 'EXPIREAT', 'FCALL',
  'FLUSHALL', 'FLUSHDB', 'GEOADD', 'GETDEL', 'GETEX', 'GETSET', 'HDEL', 'HINCRBY', 'HINCRBYFLOAT', 'HMSET', 'HSET',
  'HSETNX', 'INCR', 'INCRBY', 'INCRBYFLOAT', 'JSON.DEL', 'JSON.SET', 'LINSERT', 'LMOVE', 'LPOP', 'LPUSH', 'LPUSHX',
  'LREM', 'LSET', 'LTRIM', 'MIGRATE', 'MOVE', 'MSET', 'MSETNX', 'PERSIST', 'PEXPIRE', 'PEXPIREAT', 'PFADD', 'PFMERGE',
  'PSETEX', 'RENAME', 'RENAMENX', 'RESTORE', 'RPOP', 'RPOPLPUSH', 'RPUSH', 'RPUSHX', 'SADD', 'SDIFFSTORE', 'SET',
  'SETBIT', 'SETEX', 'SETNX', 'SETRANGE', 'SINTERSTORE', 'SMOVE', 'SPOP', 'SREM', 'SUNIONSTORE', 'SWAPDB', 'UNLINK',
  'XACK', 'XADD', 'XAUTOCLAIM', 'XCLAIM', 'XDEL', 'XGROUP', 'XSETID', 'XTRIM', 'ZADD', 'ZDIFFSTORE', 'ZINCRBY',
  'ZINTERSTORE', 'ZPOPMAX', 'ZPOPMIN', 'ZRANGESTORE', 'ZREM', 'ZREMRANGEBYLEX', 'ZREMRANGEBYRANK',
  'ZREMRANGEBYSCORE', 'ZUNIONSTORE',
]);

/**
 * Key-value writes whose names other Node objects share (a Map's `set`, fs's `unlink`, `rename`, `copy` and
 * `appendFile`'s kin, a script's `eval`): in Node code they count only on a receiver named like a client.
 */
export const SHARED_METHOD_NAMES: ReadonlySet<string> = new Set(['APPEND', 'COPY', 'EVAL', 'MOVE', 'RENAME', 'RESTORE', 'SET', 'UNLINK']);

/**
 * A method call in Node code, with the name it is called on: `cache` in `this.cache.del(`, none in `.multi().del(`.
 * Only a JSON module's methods (`client.json.set(`) take a dotted name. The receiver starts after no name character,
 * `$` included: a `\b` start lets each `$` of a long `a$a$...` run start a new try, which takes time quadratic in the
 * run's length.
 */
const METHOD_CALL = /(?:(?<![\w$])([A-Za-z_$][\w$]*)\s*)?\.\s*((?:json\.)?[A-Za-z]+)\s*\(/g;

/** The word that marks a key-value client in a receiver's name whatever the team adds: `client`, `cacheClient`. */
const BUILT_IN_RECEIVER = 'client';

/** A command a Lua script runs through its host's call function: `kv.call('DEL', ...)`, `kv.pcall("set", ...)`. */
const LUA_CALL = /\b[A-Za-z_]\w*\.p?call\s*\(\s*['"]([A-Za-z.]+)['"]/g;

/** A module Node code loads: `require('x')`, `import('x')`, `from 'x'`, `import 'x'`. */
const MODULE_LOAD = /(?:require\s*\(\s*|import\s*\(\s*|\bfrom\s+|\bimport\s+)['"]([^'"]+)['"]/g;

/** SQL statements that change stored data or its schema; `REPLACE` and `MERGE` only as `... INTO`, not the string function. */
const SQL_WRITE = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|(?:REPLACE|MERGE)(?=\s+INTO\b))\b/gi;

/** The team's rules for Node code: the client modules whose calls write, and the words that name a key-value client. */
export type ClientRules = Pick<DbWriteGuardConfig, 'nodeClients' | 'clientReceivers'>;

/** The distinct matches of `pattern`'s first group in `text`, in the order first met, each through `name`. */
function namesOf(text: string, pattern: RegExp, name: (match: string) => string = (match) => match): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const group = match[1];
    if (group !== undefined) {
      found.add(name(group));
    }
  }
  return [...found];
}

/** The writes document-shell code names: `db.c.deleteMany(...)`, `db.c.aggregate([{ $out: 'x' }])`. */
export function documentShellWritesIn(code: string): string[] {
  return [...namesOf(code, DOCUMENT_SHELL_WRITE), ...namesOf(code, WRITE_STAGE, (stage) => `$${stage}`)];
}

/** True when `name`, in any case, is a key-value command that changes stored data. */
export function isKeyValueWrite(name: string): boolean {
  return KEY_VALUE_WRITES.has(name.toUpperCase());
}

/** The key-value writes a command stream runs, one command a line (`echo "DEL x" | kvcli`), upper case. */
export function keyValueCommandWritesIn(text: string): string[] {
  const commands = text.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0] ?? '');
  return [...new Set(commands.filter(isKeyValueWrite).map((command) => command.toUpperCase()))];
}

/** The key-value writes a Lua script runs through its host's `call` or `pcall`, upper case. */
export function luaWritesIn(script: string): string[] {
  return namesOf(script, LUA_CALL, (command) => command.toUpperCase()).filter(isKeyValueWrite);
}

/**
 * The SQL writes a statement list names, upper case: `DROP` in `DROP TABLE t`.
 *
 * Comments and psql echo text are dropped first, so prose that mentions a write names none (#2536). Where the
 * dialects disagree on what a comment is, a write any reading finds counts: a comment is skipped only when every
 * reading agrees it is one.
 */
export function sqlWritesIn(sql: string): string[] {
  const first = new Map<string, number>();
  for (const reading of sqlReadings(sql)) {
    for (const match of reading.matchAll(SQL_WRITE)) {
      const keyword = match[1];
      if (keyword === undefined) continue;
      const name = keyword.toUpperCase();
      const at = match.index ?? 0;
      // The order the words were first met in, so a report reads like the statement list.
      const seen = first.get(name);
      if (seen === undefined || at < seen) first.set(name, at);
    }
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

/** The psql meta-commands whose text is prose for the reader, never SQL the server runs. */
const PSQL_ECHO = /^\\(?:echo|qecho|warn)(?![A-Za-z])/;

/**
 * The SQL readings `sql` allows, with the spans the server never runs blanked: `--` comments, block comments and
 * the text of psql's `\echo`, `\qecho` and `\warn`.
 *
 * Two things differ by server, so each is read both ways and the caller counts a write any reading finds, which
 * skips a span only where every reading agrees it is not code:
 *
 * - a backslash escapes the quote that follows it in a `'...'` literal only with `standard_conforming_strings`
 *   off;
 * - a block comment nests in PostgreSQL, and ends at the first closing marker in MySQL and SQLite.
 * - MySQL starts a `--` comment only when a space or control character follows it (`1--1` is arithmetic there), while
 *   PostgreSQL and SQLite start one at any `--`.
 *
 * What the server does run stays as it is: string literals, whose text a trailing meta-command may run as SQL;
 * dollar-quoted bodies; quoted identifiers; and MySQL's executable comments, which MySQL runs.
 */
function sqlReadings(sql: string): string[] {
  const readings: string[] = [];
  for (const backslashEscapes of [false, true]) {
    for (const nested of [true, false]) {
      for (const mysqlCommentNeedsSpace of [false, true]) {
        readings.push(blankNonCode(sql, backslashEscapes, nested, mysqlCommentNeedsSpace));
      }
    }
  }
  return readings;
}

/** `sql` with every span the server does not run replaced by spaces, keeping each newline in place. */
function blankNonCode(sql: string, backslashEscapes: boolean, nested: boolean, mysqlCommentNeedsSpace: boolean): string {
  const out = sql.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--' && !(mysqlCommentNeedsSpace && !isMysqlCommentStart(sql[i + 2]))) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*' && sql[i + 2] !== '!') {
      // MySQL executes /*! ... */; every other block comment is prose. Nesting is read per dialect.
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (nested && sql.startsWith('/*', j)) {
          depth++;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (sql[i] === "'") {
      // A literal the server runs: its text may hold a write (`\gexec`), so it stays.
      let j = i + 1;
      while (j < sql.length) {
        if (backslashEscapes && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    if (sql[i] === '"') {
      // A quoted identifier: an identifier, so a `--` inside it starts nothing.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    if (sql[i] === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? sql.length : close + tag[0].length;
        continue;
      }
    }
    if (sql[i] === '\\') {
      const meta = PSQL_ECHO.exec(sql.slice(i));
      if (meta) {
        // Its text runs to the end of the line, or to a backslash before it: `\gexec` after an echo, or a doubled `\\`,
        // ends the text and the line goes on as SQL.
        const from = i + meta[0].length;
        const newline = sql.indexOf('\n', from);
        const lineEnd = newline === -1 ? sql.length : newline;
        const backslash = sql.indexOf('\\', from);
        const stop = backslash !== -1 && backslash < lineEnd ? backslash : lineEnd;
        blank(i, stop);
        i = stop;
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

/** True when `char`, the one after a `--`, is what MySQL requires for a comment to start there. */
function isMysqlCommentStart(char: string | undefined): boolean {
  if (char === undefined) return true;
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

/** The vocabularies of the team's clients Node code loads: a module by its name, or a `module/sub` path under it. */
export function clientVocabulariesIn(code: string, rules: ClientRules): DbClientVocabulary[] {
  const loaded = namesOf(code, MODULE_LOAD);
  const found = new Set<DbClientVocabulary>();
  for (const client of rules.nodeClients) {
    if (loaded.some((spec) => spec === client.module || spec.startsWith(`${client.module}/`))) {
      found.add(client.vocabulary);
    }
  }
  return [...found];
}

/** The key-value writes Node code calls: `cache.hset(`, `client.flushAll(`, and `set` only on a client-named receiver. */
function keyValueClientWritesIn(code: string, receivers: readonly string[]): string[] {
  const words = [BUILT_IN_RECEIVER, ...receivers].map((word) => word.toLowerCase());
  const namedLikeClient = (receiver: string): boolean => words.some((word) => receiver.toLowerCase().includes(word));
  const found = new Set<string>();
  for (const match of code.matchAll(METHOD_CALL)) {
    const [, receiver, method] = match;
    if (method === undefined || !isKeyValueWrite(method)) {
      continue;
    }
    if (!SHARED_METHOD_NAMES.has(method.toUpperCase()) || (receiver !== undefined && namedLikeClient(receiver))) {
      found.add(method);
    }
  }
  return [...found];
}

/**
 * The writes Node code makes through a client the team names and the code loads; none when it loads none, so a
 * script that never touches a database is never read as one.
 */
export function clientWritesIn(code: string, rules: ClientRules): string[] {
  const vocabularies = clientVocabulariesIn(code, rules);
  const found = new Set<string>();
  if (vocabularies.includes('document')) {
    for (const name of [
      ...namesOf(code, DOCUMENT_CLIENT_WRITE),
      ...namesOf(code, MODEL_CREATE),
      ...namesOf(code, WRITE_STAGE, (stage) => `$${stage}`),
    ]) {
      found.add(name);
    }
  }
  if (vocabularies.includes('key-value')) {
    for (const name of keyValueClientWritesIn(code, rules.clientReceivers)) {
      found.add(name);
    }
  }
  return [...found];
}
