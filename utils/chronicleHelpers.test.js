const assert = require('assert');
const {
  audienceForChallenge,
  shouldRecordCheckin,
  shouldRecordRitualComplete,
  buildFeedQuery,
  awardedStreakMilestones
} = require('./chronicleHelpers');

const owner = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const friend = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const squadId = 'cccccccccccccccccccccccc';

assert.strictEqual(audienceForChallenge({ inviteOnly: true, challengeType: 'habit' }), 'squad');
assert.strictEqual(audienceForChallenge({ privacy: 'public', challengeType: 'habit' }), 'public');
assert.strictEqual(audienceForChallenge({ privacy: 'private', inviteOnly: false }), null);

assert.strictEqual(shouldRecordCheckin('public', ['2026-10-27'], '2026-10-27'), true);
assert.strictEqual(shouldRecordCheckin('public', ['2026-10-26'], '2026-10-27'), false);
assert.strictEqual(shouldRecordCheckin(null, ['2026-10-27'], '2026-10-27'), false);

assert.strictEqual(shouldRecordRitualComplete('squad', true), true);
assert.strictEqual(shouldRecordRitualComplete(null, true), false);

assert.strictEqual(buildFeedQuery({ viewerId: owner, friendIds: [], squadChallengeIds: [] }), null);

const query = buildFeedQuery({
  viewerId: owner,
  friendIds: [friend, owner],
  squadChallengeIds: [squadId]
});
assert.deepStrictEqual(query.actorId, { $ne: owner });
assert.strictEqual(query.$or.length, 2);
assert.deepStrictEqual(query.$or[0], { actorId: { $in: [friend] }, audience: 'public' });

assert.deepStrictEqual(
  awardedStreakMilestones([
    { awarded: true, meta: { milestone: 7 } },
    { awarded: false, meta: { milestone: 14 } },
    { awarded: true, meta: { milestone: 3 } },
    { awarded: true, meta: { milestone: 7 } }
  ]),
  [7]
);

console.log('chronicleHelpers.test.js: all assertions passed');
