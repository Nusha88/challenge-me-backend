const assert = require('assert');

const { getLastCompleteWeekBounds } = require('./weeklyChronicleReport');

function runTests() {
  // Sunday 2026-07-19 (matches the example in the issue):
  // previous complete Sun–Sat week should be 2026-07-12..2026-07-18
  const bounds = getLastCompleteWeekBounds('2026-07-19');

  assert.strictEqual(bounds.start, '2026-07-12');
  assert.strictEqual(bounds.end, '2026-07-18');
  assert.strictEqual(bounds.weekKey, '2026-07-12_2026-07-18');

  assert.strictEqual(bounds.dayKeys[0], '2026-07-12');
  assert.strictEqual(bounds.dayKeys[bounds.dayKeys.length - 1], '2026-07-18');
  assert.strictEqual(bounds.dayKeys.length, 7);

  console.log('weeklyChronicleReport.test.js: all tests passed');
}

runTests();

