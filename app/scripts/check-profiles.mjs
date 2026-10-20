// Checks the pure rules behind tracking profiles and alert presets: node app/scripts/check-profiles.mjs
import assert from 'node:assert/strict';
import { fitCount, inProfile, presetPatch, profileScope, snapshotChoices, tierOf, uniformChoices } from '../src/lib/profileLogic.ts';

const player = { key: 'nba:player:1', kind: 'player', teamKey: 'nba:team:9' };
const team = { key: 'mlb:team:3', kind: 'team' };
const follows = new Map([[player.key, player], [team.key, team]]);

// scope: null for no profile; a tracked player brings their team; an unfollowed member drops out
assert.equal(profileScope(null, follows), null);
assert.deepEqual([...profileScope({ id: 'a', name: 'A', keys: [player.key, 'gone'] }, follows)].sort(), [player.key, 'nba:team:9'].sort());
assert.equal(profileScope({ id: 'b', name: 'B', keys: ['gone'] }, follows).size, 0);

// inProfile: no scope passes everything; notices and favorites always pass; otherwise the target key decides
const scope = profileScope({ id: 'a', name: 'A', keys: [team.key] }, follows);
const item = (type, key, fav) => ({ type, target: { key }, fav });
assert.ok(inProfile(null, item('x', 'other')));
assert.ok(inProfile(scope, item('x', team.key)));
assert.ok(!inProfile(scope, item('x', 'other')));
assert.ok(inProfile(scope, item('app.notice', 'other')));
assert.ok(inProfile(scope, item('x', 'other', true)));

// tiers
assert.equal(tierOf(false, true), 'off');
assert.equal(tierOf(true, false), 'feed');
assert.equal(tierOf(true, true), 'push');
assert.deepEqual(uniformChoices(['a', 'b'], 'feed'), { a: 'feed', b: 'feed' });

// snapshot resolves an override against the global setting it leaves alone
assert.deepEqual(snapshotChoices({ a: false, b: true }, { b: false }, () => true, () => true), { a: 'off', b: 'feed' });
assert.deepEqual(snapshotChoices({}, { c: true }, () => false, () => false), { c: 'off' });

// patch clears every current entry, overlays the preset, skips types that don't apply, and clears push for off
const patch = presetPatch({ a: 'push', b: 'off', zzz: 'push' }, ['a', 'b', 'c'], { old: true, b: true }, { old: false });
assert.deepEqual(patch.types, { old: null, b: false, a: true });
assert.deepEqual(patch.push, { old: null, a: true, b: null });
assert.equal(fitCount({ a: 'push', zzz: 'feed' }, ['a', 'b']), 1);
assert.equal(fitCount({ zzz: 'feed' }, ['a', 'b']), 0);

console.log('profiles and presets: ok');
