const assert = require('assert');
const { resolveStreakFromDays } = require('./userStreak');

function fromOffsets(offsets) {
  const filled = new Set(offsets);
  return resolveStreakFromDays((index) => filled.has(index));
}

function range(from, to) {
  const list = [];
  for (let i = from; i <= to; i += 1) list.push(i);
  return list;
}

assert.deepStrictEqual(fromOffsets([0, ...range(2, 41)]), { days: 41, status: 'live' });
assert.deepStrictEqual(fromOffsets(range(2, 41)), { days: 40, status: 'paused' });
assert.deepStrictEqual(fromOffsets(range(3, 42)), { days: 40, status: 'cooled' });
assert.deepStrictEqual(fromOffsets(range(4, 43)), { days: 0, status: 'empty' });

const everyOther = fromOffsets([0, 2, 4, 6, 8, 10, 12]);
assert.strictEqual(everyOther.days, 3);
assert.strictEqual(everyOther.status, 'live');

assert.deepStrictEqual(fromOffsets(range(1, 10)), { days: 10, status: 'live' });

console.log('userStreak.test.js: all assertions passed');
