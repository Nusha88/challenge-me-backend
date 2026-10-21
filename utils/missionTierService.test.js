const assert = require('assert');
const { SPARKS_AMOUNTS } = require('../constants/sparksRules');
const { SYSTEM_TEMPLATE_IDS } = require('../constants/systemTemplates');
const {
  MISSION_TIERS,
  getTierRewards
} = require('./missionTierService');
const {
  getIsoWeekNumber,
  getWeeklyRitualIdForDate,
  isWeeklyRitualTemplate,
  isWeeklyRitualChallenge
} = require('./weeklyRitual');

function runTests() {
  assert.strictEqual(SPARKS_AMOUNTS.WEEKLY_RITUAL_COMPLETION, 150);
  assert.strictEqual(Math.round(SPARKS_AMOUNTS.WEEKLY_RITUAL_COMPLETION * 0.53), 80);

  assert.strictEqual(getTierRewards(MISSION_TIERS.PERFECT).sparks, 75);
  assert.strictEqual(getTierRewards(MISSION_TIERS.BRIGHT).sparks, 75);
  assert.strictEqual(getTierRewards(MISSION_TIERS.SUSTAINED).sparks, 40);
  assert.strictEqual(getTierRewards(MISSION_TIERS.EXTINGUISHED).sparks, 0);

  const weekly = { isWeeklyRitual: true };
  assert.strictEqual(getTierRewards(MISSION_TIERS.PERFECT, weekly).sparks, 150);
  assert.strictEqual(getTierRewards(MISSION_TIERS.BRIGHT, weekly).sparks, 150);
  assert.strictEqual(getTierRewards(MISSION_TIERS.SUSTAINED, weekly).sparks, 80);
  assert.strictEqual(getTierRewards(MISSION_TIERS.EXTINGUISHED, weekly).sparks, 0);

  const featuredId = getWeeklyRitualIdForDate(new Date('2026-10-21T12:00:00Z'));
  assert.ok(SYSTEM_TEMPLATE_IDS.includes(featuredId));
  assert.strictEqual(
    featuredId,
    SYSTEM_TEMPLATE_IDS[getIsoWeekNumber(new Date('2026-10-21T12:00:00Z')) % SYSTEM_TEMPLATE_IDS.length]
  );
  assert.strictEqual(isWeeklyRitualTemplate(featuredId, new Date('2026-10-21T12:00:00Z')), true);

  const otherId = SYSTEM_TEMPLATE_IDS.find((id) => id !== featuredId);
  assert.strictEqual(
    isWeeklyRitualChallenge({
      templateId: featuredId,
      createdAt: '2026-10-21T12:00:00Z'
    }),
    true
  );
  assert.strictEqual(
    isWeeklyRitualChallenge({
      templateId: otherId,
      createdAt: '2026-10-21T12:00:00Z'
    }),
    false
  );
  assert.strictEqual(
    isWeeklyRitualChallenge({
      isWeeklyRitual: true,
      templateId: otherId,
      createdAt: '2026-10-21T12:00:00Z'
    }),
    true
  );

  console.log('missionTierService tests passed');
}

runTests();
