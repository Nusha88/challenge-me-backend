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
  extraSlotSpendKey,
  extraSharedIds,
  extraPersonalTemplates,
  sharedChallengeIds,
  personalTemplates,
  canAddExtraShared,
  canAddExtraPersonal,
  EXTRA_SLOT_COST,
  EXTRA_SHARED_MAX,
  EXTRA_PERSONAL_MAX,
  findPersonalClone,
  shouldClonePersonal,
  resolveCampaignStatus,
  cloneActionsUnchecked,
  applyCheckedOntoActions
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

const locked = applyCheckedOntoActions(
  [
    { _id: 'a1', text: 'Book 1', checked: false, children: [{ _id: 'c1', text: 'Ch 1', checked: false }] }
  ],
  [
    { _id: 'a1', text: 'Changed', checked: true, children: [{ _id: 'c1', text: 'Nope', checked: true }] },
    { _id: 'extra', text: 'New step', checked: true, children: [] }
  ]
);
assert.strictEqual(locked.length, 1);
assert.strictEqual(locked[0].text, 'Book 1');
assert.strictEqual(locked[0].checked, true);
assert.strictEqual(locked[0].children[0].text, 'Ch 1');
assert.strictEqual(locked[0].children[0].checked, true);

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

const extraCampaign = {
  ...campaign,
  extraSharedChallengeIds: ['ffffffffffffffffffffffff'],
  extraPersonalTemplates: [{
    challengeId: '111111111111111111111111',
    title: 'Write a letter',
    actions: [{ text: 'Draft', checked: false, children: [] }]
  }],
  personalClones: [
    { userId: owner, challengeId: 'eeeeeeeeeeeeeeeeeeeeeeee' },
    {
      userId: owner,
      challengeId: '222222222222222222222222',
      sourceChallengeId: '111111111111111111111111'
    }
  ]
};

assert.strictEqual(EXTRA_SLOT_COST, 50);
assert.strictEqual(EXTRA_SHARED_MAX, 1);
assert.strictEqual(EXTRA_PERSONAL_MAX, 1);
assert.strictEqual(
  extraSlotSpendKey('dddddddddddddddddddddddd', 'shared', 1),
  'campaign-extra-slot:dddddddddddddddddddddddd:shared:1'
);
assert.deepStrictEqual(extraSharedIds(campaign), []);
assert.strictEqual(canAddExtraShared(campaign), true);
assert.strictEqual(canAddExtraPersonal(campaign), true);
assert.strictEqual(canAddExtraShared(extraCampaign), false);
assert.strictEqual(canAddExtraPersonal(extraCampaign), false);
assert.deepStrictEqual(sharedChallengeIds(extraCampaign), [
  'dddddddddddddddddddddddd',
  'ffffffffffffffffffffffff'
]);
assert.strictEqual(personalTemplates(extraCampaign).length, 2);
assert.strictEqual(extraPersonalTemplates(extraCampaign).length, 1);
assert.strictEqual(hasBothSlots(extraCampaign), true);
assert.strictEqual(Boolean(findPersonalClone(extraCampaign, owner)), true);
assert.strictEqual(
  String(findPersonalClone(extraCampaign, owner, '111111111111111111111111').challengeId),
  '222222222222222222222222'
);
assert.strictEqual(shouldClonePersonal(extraCampaign, owner), false);
assert.strictEqual(shouldClonePersonal(extraCampaign, friend), true);
assert.strictEqual(shouldClonePersonal(campaign, owner), false);

console.log('campaignHelpers.test.js: all assertions passed');
