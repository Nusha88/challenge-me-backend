const assert = require('assert');
const {
  buildAdminMissionsMatchStage,
  resolveMissionStatus,
  mapAdminMissionRow
} = require('./adminMissionsService');
const { CAMPAIGN_ROLES } = require('./campaignHelpers');

const today = new Date('2026-11-02T12:00:00');
today.setHours(0, 0, 0, 0);

const baseMatch = buildAdminMissionsMatchStage({ today });
assert.deepStrictEqual(baseMatch.campaignRole, { $ne: CAMPAIGN_ROLES.PERSONAL_TEMPLATE });

const searchMatch = buildAdminMissionsMatchStage({ searchQuery: 'water', today });
assert.strictEqual(searchMatch.title.$regex, 'water');

const typeMatch = buildAdminMissionsMatchStage({ challengeType: 'result', today });
assert.strictEqual(typeMatch.challengeType, 'result');

const privateMatch = buildAdminMissionsMatchStage({ privacy: 'private', today });
assert.strictEqual(privateMatch.privacy, 'private');
const publicMatch = buildAdminMissionsMatchStage({ privacy: 'public', today });
assert.deepStrictEqual(publicMatch.privacy, { $ne: 'private' });

const upcoming = buildAdminMissionsMatchStage({ status: 'upcoming', today });
assert.ok(upcoming.startDate.$gte instanceof Date);
assert.ok(upcoming.startDate.$gte > today);

const active = buildAdminMissionsMatchStage({ status: 'active', today });
assert.ok(active.startDate.$lt instanceof Date);
assert.deepStrictEqual(active.endDate.$gte, today);
assert.ok(Array.isArray(active.$nor));

const archived = buildAdminMissionsMatchStage({ status: 'archived', today });
assert.ok(Array.isArray(archived.$or));

assert.strictEqual(
  resolveMissionStatus({
    startDate: '2026-12-01',
    endDate: '2026-12-14'
  }, today),
  'upcoming'
);
assert.strictEqual(
  resolveMissionStatus({
    startDate: '2026-10-01',
    endDate: '2026-10-14'
  }, today),
  'archived'
);
assert.strictEqual(
  resolveMissionStatus({
    startDate: '2026-11-01',
    endDate: '2026-11-14',
    challengeType: 'habit'
  }, today),
  'active'
);

const mapped = mapAdminMissionRow({
  _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  title: 'Morning water',
  challengeType: 'habit',
  privacy: 'public',
  participantsCount: 4,
  ownerName: 'Elena',
  ownerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  visibility: true,
  campaignRole: 'shared',
  startDate: '2026-11-01',
  endDate: '2026-11-14',
  updatedAt: '2026-11-02T08:00:00.000Z'
}, today);

assert.strictEqual(mapped.ownerId, 'aaaaaaaaaaaaaaaaaaaaaaaa');
assert.strictEqual(mapped.campaignRole, 'shared');
assert.strictEqual(mapped.status, 'active');
assert.ok(mapped.lastActivityAt);

const cloneRow = mapAdminMissionRow({
  _id: 'cccccccccccccccccccccccc',
  title: 'Quest',
  challengeType: 'result',
  campaignRole: 'personalClone',
  startDate: '2026-11-01',
  endDate: '2026-11-14'
}, today);
assert.strictEqual(cloneRow.campaignRole, 'personalClone');

const hiddenTemplate = mapAdminMissionRow({
  _id: 'dddddddddddddddddddddddd',
  title: 'Template',
  campaignRole: 'personalTemplate',
  startDate: '2026-11-01',
  endDate: '2026-11-14'
}, today);
assert.strictEqual(hiddenTemplate.campaignRole, null);

console.log('adminMissionsService.test.js: all assertions passed');
