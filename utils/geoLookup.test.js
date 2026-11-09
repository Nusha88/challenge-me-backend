const assert = require('assert')
const { normalizeIp, isPublicIp, countryName, lookupGeo, clientIp } = require('./geoLookup')

assert.strictEqual(normalizeIp('::ffff:8.8.8.8'), '8.8.8.8')
assert.strictEqual(isPublicIp('127.0.0.1'), false)
assert.strictEqual(isPublicIp('10.0.0.4'), false)
assert.strictEqual(isPublicIp('192.168.1.1'), false)
assert.strictEqual(isPublicIp('172.16.0.1'), false)
assert.strictEqual(isPublicIp('::1'), false)
assert.strictEqual(isPublicIp('not-an-ip'), false)
assert.strictEqual(isPublicIp('8.8.8.8'), true)

assert.strictEqual(countryName('RU'), 'Russia')
assert.strictEqual(lookupGeo('127.0.0.1'), null)

const google = lookupGeo('8.8.8.8')
assert.ok(google, 'geoip-lite should resolve 8.8.8.8')
assert.strictEqual(google.countryCode, 'US')
assert.ok(google.country)

assert.strictEqual(
  clientIp({ headers: { 'x-forwarded-for': '8.8.8.8, 10.0.0.1' }, ip: '10.0.0.1' }),
  '8.8.8.8'
)

console.log('geoLookup.test.js: all assertions passed')
