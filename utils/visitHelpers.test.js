const assert = require('assert')
const {
  isValidVisitorId,
  sanitizePath,
  referrerHost,
  parseDevice,
  parseUtm,
  parseEvent,
  isSamePageviewDebounce
} = require('./visitHelpers')

assert.strictEqual(isValidVisitorId('not-a-uuid'), false)
assert.strictEqual(
  isValidVisitorId('550e8400-e29b-41d4-a716-446655440000'),
  true
)

assert.strictEqual(sanitizePath(''), '/')
assert.strictEqual(sanitizePath('/register?x=1'), '/register')
assert.strictEqual(sanitizePath('https://ignite-me.app/missions'), '/missions')

assert.strictEqual(referrerHost('https://t.me/share/url'), 't.me')
assert.strictEqual(referrerHost('not a url'), '')

assert.strictEqual(parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'mobile')
assert.strictEqual(parseDevice('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'tablet')
assert.strictEqual(parseDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)'), 'desktop')

assert.deepStrictEqual(
  parseUtm({ utm_source: 'tg', utm_medium: 'social', utm_campaign: 'beta' }),
  { utmSource: 'tg', utmMedium: 'social', utmCampaign: 'beta' }
)

assert.strictEqual(parseEvent('landing_cta_click'), 'landing_cta_click')
assert.strictEqual(parseEvent('hack'), 'pageview')

assert.strictEqual(
  isSamePageviewDebounce({ lastPath: '/', lastSeenAt: new Date() }, '/'),
  true
)
assert.strictEqual(
  isSamePageviewDebounce({ lastPath: '/', lastSeenAt: new Date(Date.now() - 60000) }, '/'),
  false
)

console.log('visitHelpers.test.js: all assertions passed')
