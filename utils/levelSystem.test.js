const assert = require('assert');
const { getRank, getRankTier, getLevelName } = require('./levelSystem');

function runTests() {
  assert.strictEqual(getRank(1), 'I');
  assert.strictEqual(getRankTier(1), 0);
  assert.strictEqual(getLevelName(1, 'ru'), 'Первопроходец');
  assert.strictEqual(getLevelName(1, 'en'), 'Pathfinder');

  assert.strictEqual(getRank(6), 'II');
  assert.strictEqual(getRankTier(8), 0);
  assert.strictEqual(getLevelName(6, 'ru'), 'Хранитель Искры');
  assert.strictEqual(getLevelName(8, 'en'), 'Spark Keeper');

  assert.strictEqual(getRank(11), 'III');
  assert.strictEqual(getRankTier(11), 1);
  assert.strictEqual(getRankTier(15), 1);
  assert.strictEqual(getRankTier(16), 2);
  assert.strictEqual(getRankTier(20), 2);
  assert.strictEqual(getLevelName(12, 'ru'), 'Пламенный Адепт');
  assert.strictEqual(getLevelName(12, 'en'), 'Flame Adept');

  assert.strictEqual(getRank(21), 'IV');
  assert.strictEqual(getRankTier(21), 1);
  assert.strictEqual(getRankTier(26), 2);
  assert.strictEqual(getRankTier(31), 3);
  assert.strictEqual(getRankTier(36), 4);
  assert.strictEqual(getRankTier(40), 4);

  assert.strictEqual(getRank(41), 'V');
  assert.strictEqual(getRankTier(41), 1);
  assert.strictEqual(getRankTier(55), 1);
  assert.strictEqual(getRankTier(56), 2);
  assert.strictEqual(getRankTier(71), 3);
  assert.strictEqual(getRankTier(86), 4);
  assert.strictEqual(getRankTier(99), 4);

  assert.strictEqual(getRank(100), 'VI');
  assert.strictEqual(getRankTier(100), 0);
  assert.strictEqual(getLevelName(100, 'ru'), 'Легенда Ignite');
  assert.strictEqual(getLevelName(140, 'en'), 'Ignite Legend');

  console.log('levelSystem tests passed');
}

runTests();
