const assert = require('assert');
const { buildUsersListPipeline, needsChallengeCountForSort } = require('./usersListService');

function topLevelLookup(pipeline) {
  return pipeline.find((stage) => stage.$lookup);
}

function facetUserLookup(pipeline) {
  const facet = pipeline.find((stage) => stage.$facet);
  return facet?.$facet?.users?.find((stage) => stage.$lookup);
}

assert.strictEqual(needsChallengeCountForSort('missions'), true);
assert.strictEqual(needsChallengeCountForSort('xp'), false);
assert.strictEqual(needsChallengeCountForSort('newest'), false);

const pipeline = buildUsersListPipeline({ searchQuery: 'anna', skip: 0, limit: 21 });

assert.ok(Array.isArray(pipeline));
assert.strictEqual(pipeline[0].$match.name.$regex, 'anna');
assert.ok(pipeline.some((stage) => stage.$facet));
assert.strictEqual(topLevelLookup(pipeline), undefined);
assert.ok(facetUserLookup(pipeline));

const xpSort = pipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(xpSort.$sort, { xp: -1, createdAt: -1 });

const missionsPipeline = buildUsersListPipeline({
  searchQuery: null,
  skip: 0,
  limit: 21,
  sort: 'missions'
});
assert.ok(topLevelLookup(missionsPipeline));
assert.strictEqual(facetUserLookup(missionsPipeline), undefined);
const missionsSort = missionsPipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(missionsSort.$sort, { challengeCount: -1, xp: -1, createdAt: -1 });

const newestPipeline = buildUsersListPipeline({
  searchQuery: null,
  skip: 0,
  limit: 10,
  sort: 'newest'
});
assert.strictEqual(topLevelLookup(newestPipeline), undefined);
assert.ok(facetUserLookup(newestPipeline));
const newestSort = newestPipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(newestSort.$sort, { createdAt: -1, xp: -1 });

const invalidPipeline = buildUsersListPipeline({
  searchQuery: null,
  skip: 0,
  limit: 10,
  sort: 'bogus'
});
const fallbackSort = invalidPipeline.find((stage) => stage.$sort);
assert.deepStrictEqual(fallbackSort.$sort, { xp: -1, createdAt: -1 });
assert.strictEqual(topLevelLookup(invalidPipeline), undefined);

console.log('usersListService.test.js: all assertions passed');
