import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SecretScanner } from '../core/secrets.ts';
import { stepsBody, type StepInput } from './steps.ts';
import { cutText } from './text.ts';

/** A text one of teamrig's own secret shapes matches, built from parts so this file holds none. */
const SECRET = ['pass', 'word', '=', 'hunter2'].join('');
const SHAPE = new SecretScanner().find(SECRET)?.description ?? '';

const STEP: StepInput = {
  id: 'config-format',
  title: 'teamrig needs to update your team settings',
  why: 'the file is in an older layout',
  preview: ['adds budget.resets', 'renames a key'],
  command: '/teamrig steps run config-format --yes',
};

describe('stepsBody', () => {
  it('serves each step as handed in, in order, with no cut', () => {
    const body = stepsBody({ steps: [STEP, { ...STEP, id: 'other' }], shapes: new SecretScanner() });
    assert.deepEqual(body, { steps: [STEP, { ...STEP, id: 'other' }], cuts: [] });
  });

  it('cuts a preview line holding a secret by itself, naming the step, the field and the shape', () => {
    const body = stepsBody({ steps: [{ ...STEP, preview: ['adds budget.resets', `sets ${SECRET}`] }], shapes: new SecretScanner() });
    assert.deepEqual(body.steps[0]?.preview, ['adds budget.resets', cutText(SHAPE)]);
    assert.deepEqual(body.cuts, [{ id: 'config-format', field: 'preview', shape: SHAPE }]);
  });

  it('serves no step when none is pending', () => {
    assert.deepEqual(stepsBody({ steps: [], shapes: new SecretScanner() }), { steps: [], cuts: [] });
  });
});
