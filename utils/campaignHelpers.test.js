const assert = require('assert');
const {
  MIN_CAMPAIGN_DAYS,
  MAX_CAMPAIGN_DAYS,
  MAX_CAMPAIGN_MEMBERS,
  parseInviteUserIds,
  guestCount,
  remainingInviteSlots,
  isCampaignOwner,
  isCampaignInvitee,
  canViewCampaign,
  isValidCampaignDuration,
  isRangeWithinCampaign,
  hasBothSlots,
  hasPersonalTemplate,
  findPersonalClone,
  shouldClonePersonal,
  resolveCampaignStatus,
  cloneActionsUnchecked
} = require('./campaignHelpers');

const owner = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const friend = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const stranger = 'cccccccccccccccccccccccc';

assert.deepStrictEqual(parseInviteUserIds(['bad', owner, owner, friend]), [owner, friend]);
assert.strictEqual(parseInviteUserIds(null).length, 0);

const campaign = {
  status: 'open',
  owner,
  startDate: '2026-11-01',
  endDate: '2026-11-14',
  members: [{ userId: owner }],
  invites: [{ userId: friend }],
  sharedChallengeId: 'dddddddddddddddddddddddd',
  personalTemplate: {
    title: 'Read three books',
    actions: [{ text: 'Book 1', checked: true, children: [] }]
  },
  personalClones: [{ userId: owner, challengeId: 'eeeeeeeeeeeeeeeeeeeeeeee' }]
};

assert.strictEqual(isCampaignOwner(campaign, owner), true);
assert.strictEqual(isCampaignInvitee(campaign, friend), true);
assert.strictEqual(canViewCampaign(campaign, owner), true);
assert.strictEqual(canViewCampaign(campaign, friend), true);
assert.strictEqual(canViewCampaign(campaign, stranger), false);
assert.strictEqual(guestCount(campaign), 1);
assert.strictEqual(remainingInviteSlots(campaign), MAX_CAMPAIGN_MEMBERS - 2);
assert.strictEqual(hasPersonalTemplate(campaign), true);
assert.strictEqual(hasBothSlots(campaign), true);
assert.strictEqual(Boolean(findPersonalClone(campaign, owner)), true);
assert.strictEqual(shouldClonePersonal(campaign, owner), false);
assert.strictEqual(shouldClonePersonal(campaign, friend), true);

assert.strictEqual(isValidCampaignDuration('2026-11-01', '2026-11-07'), true);
assert.strictEqual(isValidCampaignDuration('2026-11-01', '2026-11-21'), true);
assert.strictEqual(isValidCampaignDuration('2026-11-01', '2026-11-06'), false);
assert.strictEqual(isValidCampaignDuration('2026-11-01', '2026-11-23'), false);
assert.ok(MIN_CAMPAIGN_DAYS === 7 && MAX_CAMPAIGN_DAYS === 21);

assert.strictEqual(
  isRangeWithinCampaign('2026-11-01', '2026-11-14', campaign),
  true
);
assert.strictEqual(
  isRangeWithinCampaign('2026-10-31', '2026-11-14', campaign),
  false
);

const cloned = cloneActionsUnchecked(campaign.personalTemplate.actions);
assert.strictEqual(cloned[0].checked, false);
assert.strictEqual(cloned[0].text, 'Book 1');

assert.strictEqual(resolveCampaignStatus({ ...campaign, status: 'draft' }), 'draft');
assert.strictEqual(
  resolveCampaignStatus({ ...campaign, status: 'open' }, new Date('2026-11-20T12:00:00Z')),
  'finished'
);
assert.strictEqual(
  resolveCampaignStatus({ ...campaign, status: 'open' }, new Date('2026-10-20T12:00:00Z')),
  'open'
);
assert.strictEqual(
  resolveCampaignStatus({ ...campaign, status: 'open' }, new Date('2026-11-05T12:00:00Z')),
  'active'
);

const full = {
  owner,
  members: [{ userId: owner }],
  invites: Array.from({ length: MAX_CAMPAIGN_MEMBERS - 1 }, (_, index) => ({
    userId: `${String(index + 1).padStart(24, 'b')}`
  }))
};
assert.strictEqual(remainingInviteSlots(full), 0);

console.log('campaignHelpers.test.js: all assertions passed');
