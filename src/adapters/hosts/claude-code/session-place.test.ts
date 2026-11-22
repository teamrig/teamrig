import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionLauncher } from './session-launcher.ts';
import { sessionPlaceOf } from './session-place.ts';

describe("Claude Code's session place", () => {
  it('reads a terminal entrypoint as a tab, and with a background kind as a background job', () => {
    assert.equal(sessionPlaceOf({ startedAs: 'cli', sessionKind: undefined }), 'tab');
    assert.equal(sessionPlaceOf({ startedAs: 'cli', sessionKind: 'bg' }), 'background');
    assert.equal(sessionPlaceOf({ startedAs: undefined, sessionKind: 'bg' }), 'background');
  });

  it("reads any other entrypoint as elsewhere, whatever the kind", () => {
    assert.equal(sessionPlaceOf({ startedAs: 'sdk-ts', sessionKind: undefined }), 'elsewhere');
    assert.equal(sessionPlaceOf({ startedAs: 'sdk-cli', sessionKind: 'bg' }), 'elsewhere');
  });

  it('says nothing when neither is told, or only a kind of no meaning', () => {
    assert.equal(sessionPlaceOf({ startedAs: undefined, sessionKind: undefined }), undefined);
    assert.equal(sessionPlaceOf({ startedAs: undefined, sessionKind: 'interactive' }), undefined);
  });

  it('is what the launcher port gives', () => {
    assert.equal(sessionLauncher({}).sessionPlaceOf, sessionPlaceOf);
  });
});
