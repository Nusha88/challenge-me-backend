const assert = require('assert');
const crypto = require('crypto');
const { verifyTelegramAuth } = require('./telegramAuth');

const BOT_TOKEN = '123456:test-token';

function sign(payload) {
  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  return crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

const valid = {
  id: 42,
  first_name: 'Ada',
  username: 'ada',
  auth_date: Math.floor(Date.now() / 1000)
};
valid.hash = sign(valid);

assert.strictEqual(verifyTelegramAuth(valid, BOT_TOKEN).ok, true);

const tampered = { ...valid, first_name: 'Eve' };
tampered.hash = valid.hash;
assert.strictEqual(verifyTelegramAuth(tampered, BOT_TOKEN).reason, 'invalid');

const expired = {
  id: 42,
  first_name: 'Ada',
  auth_date: Math.floor(Date.now() / 1000) - 48 * 60 * 60
};
expired.hash = sign(expired);
assert.strictEqual(verifyTelegramAuth(expired, BOT_TOKEN).reason, 'expired');

assert.strictEqual(verifyTelegramAuth(valid, '').reason, 'not_configured');
assert.strictEqual(verifyTelegramAuth({}, BOT_TOKEN).reason, 'invalid');

console.log('telegramAuth.test.js passed');
