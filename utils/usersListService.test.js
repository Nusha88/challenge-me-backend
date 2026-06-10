const assert = require('assert');
const { buildUsersListPipeline } = require('./usersListService');

const pipeline = buildUsersListPipeline({ searchQuery: 'anna', skip: 0, limit: 21 });

assert.ok(Array.isArray(pipeline));
assert.strictEqual(pipeline[0].$match.name.$regex, 'anna');
assert.ok(pipeline.some((stage) => stage.$lookup));
assert.ok(pipeline.some((stage) => stage.$facet));

console.log('usersListService.test.js: all assertions passed');
