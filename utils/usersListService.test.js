const assert = require('assert');
const { buildUsersListPipeline } = require('./usersListService');

const pipeline = buildUsersListPipeline({ searchQuery: 'anna', skip: 0, limit: 21 });

assert.ok(Array.isArray(pipeline));
assert.strictEqual(pipeline[0].$match.name.$regex, 'anna');
assert.ok(pipeline.some((stage) => stage.$lookup));
assert.ok(pipeline.some((stage) => stage.$facet));

const xpSort = pipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(xpSort.$sort, { xp: -1, challengeCount: -1, createdAt: -1 });

const missionsPipeline = buildUsersListPipeline({
  searchQuery: null,
  skip: 0,
  limit: 21,
  sort: 'missions'
});
const missionsSort = missionsPipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(missionsSort.$sort, { challengeCount: -1, xp: -1, createdAt: -1 });

const newestPipeline = buildUsersListPipeline({
  searchQuery: null,
  skip: 0,
  limit: 10,
  sort: 'newest'
});
const newestSort = newestPipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(newestSort.$sort, { createdAt: -1, xp: -1 });

const invalidPipeline = buildUsersListPipeline({
  searchQuery: null,
  skip: 0,
  limit: 10,
  sort: 'bogus'
});
const fallbackSort = invalidPipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(fallbackSort.$sort, { xp: -1, challengeCount: -1, createdAt: -1 });

console.log('usersListService.test.js: all assertions passed');
