const assert = require('assert');
const {
  isValidUserId,
  sortedPair,
  involvesUser,
  otherUserId,
  relationForViewer,
  parseStatusIds,
  serializeFriendship,
  MAX_STATUS_IDS
} = require('./friendshipHelpers');

const idA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const idB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const idC = 'cccccccccccccccccccccccc';

assert.strictEqual(isValidUserId(idA), true);
assert.strictEqual(isValidUserId('nope'), false);
assert.strictEqual(sortedPair(idA, idA), null);
assert.strictEqual(sortedPair('bad', idB), null);

const pair = sortedPair(idB, idA);
assert.strictEqual(String(pair.userA), idA);
assert.strictEqual(String(pair.userB), idB);

const pendingFromA = {
  _id: 'dddddddddddddddddddddddd',
  userA: idA,
  userB: idB,
  requesterId: idA,
  status: 'pending'
};

assert.strictEqual(involvesUser(pendingFromA, idA), true);
assert.strictEqual(involvesUser(pendingFromA, idC), false);
assert.strictEqual(otherUserId(pendingFromA, idA), idB);
assert.deepStrictEqual(relationForViewer(null, idA), { status: 'none', friendshipId: null });
assert.deepStrictEqual(relationForViewer(pendingFromA, idA), {
  status: 'pending_outgoing',
  friendshipId: pendingFromA._id
});
assert.deepStrictEqual(relationForViewer(pendingFromA, idB), {
  status: 'pending_incoming',
  friendshipId: pendingFromA._id
});
assert.deepStrictEqual(
  relationForViewer({ ...pendingFromA, status: 'accepted' }, idB),
  { status: 'accepted', friendshipId: pendingFromA._id }
);

const populated = {
  _id: pendingFromA._id,
  userA: { _id: idA, name: 'Ann', avatarUrl: null, xp: 10, sparks: 2, createdAt: '2026-01-01' },
  userB: { _id: idB, name: 'Ben', avatarUrl: 'x.png', xp: 20, sparks: 4, createdAt: '2026-02-01' },
  requesterId: idA,
  status: 'pending',
  createdAt: '2026-03-01',
  updatedAt: '2026-03-02'
};
const serialized = serializeFriendship(populated, idB);
assert.strictEqual(serialized.status, 'pending_incoming');
assert.strictEqual(serialized.user.name, 'Ann');
assert.strictEqual(serialized.user.xp, 10);

const parsed = parseStatusIds(`${idA},bad,${idA}, ${idB}`);
assert.deepStrictEqual(parsed, [idA, idB]);

const many = Array.from({ length: MAX_STATUS_IDS + 5 }, (_, index) =>
  `${String(index).padStart(24, '0')}`
);
assert.strictEqual(parseStatusIds(many).length, MAX_STATUS_IDS);

console.log('friendshipHelpers.test.js: all assertions passed');
