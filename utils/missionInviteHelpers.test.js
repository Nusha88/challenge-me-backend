const assert = require('assert');
const {
  MAX_SQUAD_GUESTS,
  parseInviteUserIds,
  guestCount,
  remainingInviteSlots,
  canViewInviteOnlyChallenge,
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

const full = {
  owner,
  participants: [{ userId: owner }],
  invites: Array.from({ length: MAX_SQUAD_GUESTS }, (_, index) => ({
    userId: `${String(index + 1).padStart(24, 'b')}`
  }))
};
assert.strictEqual(remainingInviteSlots(full), 0);

console.log('missionInviteHelpers.test.js: all assertions passed');
