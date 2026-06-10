const assert = require('assert');
const { buildWatchedFeedActivities } = require('./watchedFeedService');

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const userA = { _id: 'user-a', name: 'Alice', avatarUrl: 'https://example.com/a.png' };
const userB = { _id: 'user-b', name: 'Bob', avatarUrl: null };

const mockChallenges = [
  {
    _id: 'challenge-1',
    title: 'Morning Run',
    allowComments: true,
    challengeType: 'habit',
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    comments: [
      {
        _id: 'comment-1',
        userId: userA,
        text: 'Great day',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
      }
    ],
    participants: [
      {
        userId: userB,
        completedDays: [daysAgo(5), daysAgo(3), daysAgo(1)]
      }
    ]
  },
  {
    _id: 'challenge-2',
    title: 'Silent Quest',
    allowComments: false,
    challengeType: 'habit',
    endDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    comments: [
      {
        _id: 'comment-hidden',
        userId: userA,
        text: 'Should not appear',
        createdAt: new Date()
      }
    ],
    participants: [
      {
        userId: userA,
        completedDays: [daysAgo(10), daysAgo(1)]
      }
    ]
  }
];

const activities = buildWatchedFeedActivities(mockChallenges);

assert.ok(Array.isArray(activities));
assert.ok(activities.length > 0);
assert.ok(activities.length <= 50);

const types = new Set(activities.map((item) => item.type));
assert.ok(types.has('comment'));
assert.ok(types.has('join'));
assert.ok(types.has('progress'));
assert.ok(types.has('finished'));

const commentFromOpenChallenge = activities.find((item) => item.id === 'comment-challenge-1-comment-1');
assert.ok(commentFromOpenChallenge);
assert.strictEqual(commentFromOpenChallenge.challengeTitle, 'Morning Run');
assert.strictEqual(commentFromOpenChallenge.userName, 'Alice');

const hiddenComment = activities.find((item) => item.id.includes('comment-hidden'));
assert.strictEqual(hiddenComment, undefined);

const sorted = [...activities].sort(
  (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
);
assert.deepStrictEqual(
  activities.map((item) => item.id),
  sorted.map((item) => item.id)
);

console.log('watchedFeedService.test.js: all assertions passed');
