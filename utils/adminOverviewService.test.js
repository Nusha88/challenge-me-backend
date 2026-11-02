const assert = require('assert');
const { buildAdminOverviewQueries } = require('./adminOverviewService');
const { CAMPAIGN_ROLES } = require('./campaignHelpers');

const today = new Date('2026-11-02T00:00:00');
const queries = buildAdminOverviewQueries(today);

assert.deepStrictEqual(queries.usersTotal, {});
assert.deepStrictEqual(queries.usersDisabled, { status: 'disabled' });
assert.ok(queries.usersNew7d.createdAt.$gte instanceof Date);
const weekAgo = new Date(today);
weekAgo.setDate(weekAgo.getDate() - 7);
assert.strictEqual(queries.usersNew7d.createdAt.$gte.getTime(), weekAgo.getTime());

assert.deepStrictEqual(
  queries.missionsActive.campaignRole,
  { $ne: CAMPAIGN_ROLES.PERSONAL_TEMPLATE }
);
assert.deepStrictEqual(queries.missionsActive.startDate, { $ne: null, $lte: today });
assert.deepStrictEqual(queries.missionsActive.endDate, { $ne: null, $gte: today });

assert.deepStrictEqual(queries.missionsPublicVisible.privacy, { $ne: 'private' });
assert.deepStrictEqual(queries.missionsPublicVisible.visibility, { $ne: false });

assert.deepStrictEqual(queries.campaignsLive.status, { $ne: 'draft' });
assert.deepStrictEqual(queries.campaignsLive.endDate, { $gte: today });

console.log('adminOverviewService.test.js: all assertions passed');
