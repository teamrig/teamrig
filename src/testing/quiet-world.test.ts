import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quietDelivery } from './quiet-delivery.ts';
import { quietGit } from './quiet-git.ts';
import { quietHost } from './quiet-host.ts';
import { quietServices } from './quiet-services.ts';
import { quietWorld } from './quiet-world.ts';

describe('quietWorld', () => {
  it('takes each part from exactly one area, so no area quietly replaces another\'s fake', () => {
    const areas = [quietGit('dev'), quietHost(''), quietDelivery(), quietServices()].map((area) => Object.keys(area));
    const keys = areas.flat();
    const repeated = keys.filter((key, at) => keys.indexOf(key) !== at);
    assert.deepEqual(repeated, []);
    assert.deepEqual(Object.keys(quietWorld()).sort(), [...keys, 'newId'].sort());
  });

  it('puts the branch on git and stdin on readStdin', async () => {
    const world = quietWorld('feat', 'in');
    assert.equal(world.git.branch('/w'), 'feat');
    assert.equal(await world.readStdin(), 'in');
  });

  it('counts new ids up per world', () => {
    const world = quietWorld();
    assert.deepEqual([world.newId(), world.newId()], ['id-1', 'id-2']);
    assert.equal(quietWorld().newId(), 'id-1');
  });
});
