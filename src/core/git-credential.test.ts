import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CREDENTIAL_QUIT, credentialAnswer, credentialOperationOf, parseCredentialRequest } from './git-credential.ts';

describe('credentialOperationOf', () => {
  it('names get, store and erase, and nothing else', () => {
    assert.equal(credentialOperationOf('get'), 'get');
    assert.equal(credentialOperationOf('store'), 'store');
    assert.equal(credentialOperationOf('erase'), 'erase');
    assert.equal(credentialOperationOf('GET'), undefined);
    assert.equal(credentialOperationOf('fill'), undefined);
    assert.equal(credentialOperationOf(undefined), undefined);
  });
});

describe('parseCredentialRequest', () => {
  it('reads the URL parts git sends, up to the blank line', () => {
    const request = parseCredentialRequest('protocol=https\nhost=github.com\npath=acme/app.git\n\nhost=other.example\n');
    assert.deepEqual(request, { kind: 'ask', ask: { protocol: 'https', host: 'github.com', path: 'acme/app.git', username: undefined } });
  });

  it('reads a request that ends with the input, and a user name the URL held', () => {
    assert.deepEqual(parseCredentialRequest('protocol=https\nhost=github.com\nusername=octo'), {
      kind: 'ask',
      ask: { protocol: 'https', host: 'github.com', path: undefined, username: 'octo' },
    });
  });

  it('keeps a value holding = whole', () => {
    const request = parseCredentialRequest('protocol=https\nhost=github.com\npath=a/b=c\n');
    assert.equal(request.kind === 'ask' ? request.ask.path : undefined, 'a/b=c');
  });

  it('takes the repeatable keys newer git sends, more than once', () => {
    const request = parseCredentialRequest('capability[]=authtype\ncapability[]=state\nprotocol=https\nhost=github.com\nwwwauth[]=Basic realm="GitHub"\n');
    assert.equal(request.kind, 'ask');
  });

  it('refuses a carriage return or NUL anywhere', () => {
    assert.deepEqual(parseCredentialRequest('protocol=https\r\nhost=github.com\n'), { kind: 'refused', why: 'the request holds a carriage return or NUL' });
    assert.equal(parseCredentialRequest('protocol=https\nhost=github.com\0evil\n').kind, 'refused');
  });

  it('refuses an unknown key, a line with no key, and a single key given twice', () => {
    assert.deepEqual(parseCredentialRequest('protocol=https\nhostname=github.com\n'), { kind: 'refused', why: 'the request holds the unknown key hostname' });
    assert.deepEqual(parseCredentialRequest('protocol=https\n=github.com\n'), { kind: 'refused', why: 'a request line is not key=value' });
    assert.deepEqual(parseCredentialRequest('protocol\n'), { kind: 'refused', why: 'a request line is not key=value' });
    assert.deepEqual(parseCredentialRequest('host=github.com\nhost=other.example\n'), { kind: 'refused', why: 'the request gives host twice' });
  });
});

describe('credentialAnswer', () => {
  it('gives the user name and the key as git reads them', () => {
    assert.equal(credentialAnswer('x-access-token', 'k1'), 'username=x-access-token\npassword=k1\n');
  });

  it('gives no answer for a value that is empty or would add a line', () => {
    assert.equal(credentialAnswer('x-access-token', ''), undefined);
    assert.equal(credentialAnswer('x-access-token', 'k1\nquit=0'), undefined);
    assert.equal(credentialAnswer('x\r', 'k1'), undefined);
    assert.equal(credentialAnswer('x', 'k\0'), undefined);
  });

  it('stops git asking anyone else when it gives no key', () => {
    assert.equal(CREDENTIAL_QUIT, 'quit=1\n');
  });
});
