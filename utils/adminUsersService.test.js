const assert = require('assert');
const {
  buildAdminUserMatchStage,
  mapAdminUserRow,
  pickIdentity
} = require('./adminUsersService');

assert.deepStrictEqual(buildAdminUserMatchStage(null), {});
assert.deepStrictEqual(buildAdminUserMatchStage(''), {});

const searchMatch = buildAdminUserMatchStage('Anna');
assert.strictEqual(searchMatch.$or[0].name.$regex, 'Anna');
assert.strictEqual(searchMatch.$or[1].email.$options, 'i');

assert.deepStrictEqual(buildAdminUserMatchStage(null, 'disabled'), { status: 'disabled' });
assert.deepStrictEqual(buildAdminUserMatchStage(null, 'active'), { status: { $ne: 'disabled' } });

const combined = buildAdminUserMatchStage('hero', 'disabled');
assert.ok(combined.$and);
assert.strictEqual(combined.$and[0].$or[0].name.$regex, 'hero');
assert.deepStrictEqual(combined.$and[1], { status: 'disabled' });

const createdAt = new Date('2026-03-04T10:00:00.000Z');
const mapped = mapAdminUserRow({
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Elena',
  email: '',
  xp: 120,
  sparks: 8,
  missionsTotal: 3,
  missionsActive: 1,
  status: 'active',
  createdAt,
  identities: [{ provider: 'telegram' }]
});

assert.strictEqual(mapped.id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
assert.strictEqual(mapped.email, '');
assert.strictEqual(mapped.identity, 'telegram');
assert.strictEqual(mapped.createdAt, createdAt.toISOString());
assert.ok(mapped.level >= 1);

assert.strictEqual(pickIdentity({ identities: [{ provider: 'google' }] }), 'google');
assert.strictEqual(pickIdentity({ identities: [] }), null);
assert.strictEqual(
  pickIdentity({ identities: [{ provider: 'google' }, { provider: 'telegram' }] }),
  'telegram'
);

console.log('adminUsersService.test.js: all assertions passed');
