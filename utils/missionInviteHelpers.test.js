const assert = require('assert');
const {
  MAX_SQUAD_GUESTS,
  parseInviteUserIds,
  guestCount,
  remainingInviteSlots,
  canViewInviteOnlyChallenge,
  canViewChallenge,
  isChallengeOwner,
  isChallengeInvitee
} = require('./missionInviteHelpers');

const owner = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const friend = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const stranger = 'cccccccccccccccccccccccc';

assert.deepStrictEqual(parseInviteUserIds(['bad', owner, owner, friend]), [owner, friend]);
assert.strictEqual(parseInviteUserIds(null).length, 0);
assert.deepStrictEqual(
  parseInviteUserIds([owner, friend]).filter((id) => id !== owner),
  [friend]
);

const challenge = {
  inviteOnly: true,
  owner,
  participants: [{ userId: owner }],
  invites: [{ userId: friend }]
};

assert.strictEqual(isChallengeOwner(challenge, owner), true);
assert.strictEqual(isChallengeInvitee(challenge, friend), true);
assert.strictEqual(guestCount(challenge), 1);
assert.strictEqual(remainingInviteSlots(challenge), MAX_SQUAD_GUESTS - 1);
assert.strictEqual(canViewInviteOnlyChallenge(challenge, owner), true);
assert.strictEqual(canViewInviteOnlyChallenge(challenge, friend), true);
assert.strictEqual(canViewInviteOnlyChallenge(challenge, stranger), false);
assert.strictEqual(canViewInviteOnlyChallenge(challenge, null), false);
assert.strictEqual(canViewInviteOnlyChallenge({ inviteOnly: false }, stranger), true);

const privateSolo = {
  privacy: 'private',
  inviteOnly: false,
  visibility: true,
  owner,
  participants: [{ userId: owner }]
};
assert.strictEqual(canViewChallenge(privateSolo, owner), true);
assert.strictEqual(canViewChallenge(privateSolo, stranger), false);
assert.strictEqual(canViewChallenge(privateSolo, null), false);
assert.strictEqual(canViewChallenge(privateSolo, stranger, { isSuperAdmin: true }), true);

const hiddenPublic = {
  privacy: 'public',
  visibility: false,
  owner,
  participants: [{ userId: owner }]
};
assert.strictEqual(canViewChallenge(hiddenPublic, owner), true);
assert.strictEqual(canViewChallenge(hiddenPublic, stranger), false);

const template = {
  privacy: 'private',
  campaignRole: 'personalTemplate',
  owner,
  participants: [{ userId: owner }]
};
assert.strictEqual(canViewChallenge(template, owner), true);
assert.strictEqual(canViewChallenge(template, stranger), false);

const publicMission = {
  privacy: 'public',
  visibility: true,
  owner,
  participants: [{ userId: owner }]
};
assert.strictEqual(canViewChallenge(publicMission, stranger), true);
assert.strictEqual(canViewChallenge(challenge, stranger), false);
assert.strictEqual(canViewChallenge(challenge, friend), true);

const full = {
  owner,
  participants: [{ userId: owner }],
  invites: Array.from({ length: MAX_SQUAD_GUESTS }, (_, index) => ({
    userId: `${String(index + 1).padStart(24, 'b')}`
  }))
};
assert.strictEqual(remainingInviteSlots(full), 0);

console.log('missionInviteHelpers.test.js: all assertions passed');
