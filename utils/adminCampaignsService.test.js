const assert = require('assert');
const {
  buildAdminCampaignsMatchStage,
  mapAdminCampaignRow
} = require('./adminCampaignsService');

assert.deepStrictEqual(buildAdminCampaignsMatchStage(null), {});
const search = buildAdminCampaignsMatchStage('squad');
assert.strictEqual(search.title.$regex, 'squad');
assert.strictEqual(search.title.$options, 'i');

const today = new Date('2026-11-05T12:00:00');
const mapped = mapAdminCampaignRow({
  _id: 'eeeeeeeeeeeeeeeeeeeeeeee',
  title: 'November challenge',
  status: 'open',
  membersCount: 3,
  ownerName: 'Elena',
  ownerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  sharedChallengeId: 'ffffffffffffffffffffffff',
  startDate: '2026-11-01',
  endDate: '2026-11-14'
}, today);

assert.strictEqual(mapped.id, 'eeeeeeeeeeeeeeeeeeeeeeee');
assert.strictEqual(mapped.status, 'active');
assert.strictEqual(mapped.membersCount, 3);
assert.strictEqual(mapped.ownerId, 'aaaaaaaaaaaaaaaaaaaaaaaa');
assert.strictEqual(mapped.sharedChallengeId, 'ffffffffffffffffffffffff');
assert.ok(mapped.startDate);
assert.ok(mapped.endDate);

const draft = mapAdminCampaignRow({
  _id: '111111111111111111111111',
  title: 'Draft',
  status: 'draft',
  ownerId: 'aaaaaaaaaaaaaaaaaaaaaaaa'
}, today);
assert.strictEqual(draft.status, 'draft');
assert.strictEqual(draft.sharedChallengeId, null);

console.log('adminCampaignsService.test.js: all assertions passed');
