import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PathSearchDeps } from '../core/path-search.ts';
import { probeOf } from '../testing/fake-checkout.ts';
import { FakePathProbe } from '../testing/fake-processes.ts';
import { MemoryFiles } from '../testing/memory-files.ts';
import { configDirRefusal, ghChildEnvOf, ghConfigDirOf, inertCommandOf, programOutsideCheckout } from './gh-child.ts';

const SETUP = { configDir: '/kit/gh-config', inert: '"/usr/bin/node" --eval=process.exit(1)' };

/** What a session may set to make gh start a program of its choosing, or read another config. */
const SESSION_SET: Readonly<Record<string, string>> = {
  GH_BROWSER: 'evil',
  BROWSER: 'evil',
  GH_EDITOR: 'evil',
  EDITOR: 'evil',
  VISUAL: 'evil',
  GH_PAGER: 'evil',
  PAGER: 'evil',
  GH_CONFIG_DIR: '/session/gh',
  XDG_CONFIG_HOME: '/session',
  GH_DEBUG: 'api',
  SOME_SECRET_NAME_NO_LIST_KNOWS: 'value',
  GH_TOKEN: 'session-held',
  GITHUB_TOKEN: 'session-held',
};

describe('ghChildEnvOf: the gh child’s environment is built, not inherited (T4961)', () => {
  it('keeps the allowed variables, Windows-cased names too, and nothing else the caller set', () => {
    const env = ghChildEnvOf({ Path: 'C:/bin', HOME: '/u', GH_REPO: 'acme/web', ...SESSION_SET }, SETUP);
    assert.deepEqual(env, {
      Path: 'C:/bin',
      HOME: '/u',
      GH_REPO: 'acme/web',
      GH_BROWSER: SETUP.inert,
      BROWSER: SETUP.inert,
      GH_EDITOR: SETUP.inert,
      EDITOR: SETUP.inert,
      VISUAL: SETUP.inert,
      GH_CONFIG_DIR: SETUP.configDir,
      GH_PAGER: 'cat',
      PAGER: 'cat',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
    });
  });

  it('lets no variable the caller set through by its own name', () => {
    const env = ghChildEnvOf(SESSION_SET, SETUP);
    for (const [name, value] of Object.entries(SESSION_SET)) {
      assert.notEqual(env[name], value, name);
    }
  });

  it('writes the inert command quoted, with forward slashes', () => {
    assert.equal(inertCommandOf('C:\\Program Files\\nodejs\\node.exe'), '"C:/Program Files/nodejs/node.exe" --eval=process.exit(1)');
    assert.equal(ghConfigDirOf('C:\\kit', 'win32'), 'C:\\kit\\gh-config');
  });
});

describe('configDirRefusal: gh’s config folder holds no login or setting', () => {
  it('makes a missing folder and passes it, and passes a config.yml of the format version alone', async () => {
    const files = new MemoryFiles();
    assert.equal(await configDirRefusal('/kit/gh-config', files, 'linux'), undefined);
    assert.equal(files.madeFolder('/kit/gh-config'), true);
    const versioned = new MemoryFiles({ '/kit/gh-config/config.yml': '# gh\nversion: "1"\n' });
    assert.equal(await configDirRefusal('/kit/gh-config', versioned, 'linux'), undefined);
  });

  it('refuses a planted login or any setting', async () => {
    const login = new MemoryFiles({ '/kit/gh-config/hosts.yml': 'github.com:\n  oauth_token: x\n' });
    assert.match((await configDirRefusal('/kit/gh-config', login, 'linux')) ?? '', /holds a login, \/kit\/gh-config\/hosts\.yml/u);
    for (const setting of ['browser: evil', 'aliases:\n  co: "!sh"', 'http_unix_socket: /tmp/s', 'version: 1\npager: evil']) {
      const files = new MemoryFiles({ '/kit/gh-config/config.yml': setting });
      assert.match((await configDirRefusal('/kit/gh-config', files, 'linux')) ?? '', /holds settings/u, setting);
    }
  });
});

describe('programOutsideCheckout: gh and git by an absolute path outside the checkout', () => {
  const posixSearch = (files: readonly string[], path = '/usr/bin'): PathSearchDeps => ({ env: { PATH: path }, platform: 'linux', probe: new FakePathProbe({ files }) });

  it('finds the installed program by its absolute path', async () => {
    assert.deepEqual(await programOutsideCheckout('gh', '/w', posixSearch(['/usr/bin/gh'])), { kind: 'found', path: '/usr/bin/gh' });
    const windows: PathSearchDeps = { env: { Path: 'C:\\Tools' }, platform: 'win32', probe: probeOf('C:\\Tools\\gh.exe') };
    assert.deepEqual(await programOutsideCheckout('gh', 'C:\\w', windows), { kind: 'found', path: 'C:\\Tools\\gh.exe' });
  });

  it('refuses a program missing from PATH or found by a relative folder', async () => {
    assert.match((await refusal(programOutsideCheckout('gh', '/w', posixSearch([])))), /gh is not on PATH/u);
    const relative: PathSearchDeps = { env: { PATH: 'bin' }, platform: 'linux', probe: { kind: async (path) => (path === 'bin/gh' ? 'file' : 'none') } };
    assert.match(await refusal(programOutsideCheckout('gh', '/w', relative)), /relative folder/u);
  });

  it('refuses a program inside the folder or the checkout it is in', async () => {
    assert.match(await refusal(programOutsideCheckout('gh', '/w', posixSearch(['/w/gh'], '/w'))), /inside \/w,/u);
    const checkout: PathSearchDeps = { env: { PATH: '/repo/tools' }, platform: 'linux', probe: new FakePathProbe({ folders: ['/repo/.git'], files: ['/repo/tools/gh'] }) };
    assert.match(await refusal(programOutsideCheckout('gh', '/repo/src/deep', checkout)), /inside \/repo,/u);
    const windows: PathSearchDeps = { env: { PATH: 'c:\\W\\BIN' }, platform: 'win32', probe: probeOf('c:\\W\\BIN\\gh.exe') };
    assert.match(await refusal(programOutsideCheckout('gh', 'C:\\w', windows)), /inside C:\\w,/u);
  });
});

async function refusal(found: Promise<Awaited<ReturnType<typeof programOutsideCheckout>>>): Promise<string> {
  const result = await found;
  assert.equal(result.kind, 'refused');
  return result.kind === 'refused' ? result.why : '';
}
