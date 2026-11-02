const crypto = require('crypto');

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const TELEGRAM_LOGIN_FIELDS = ['auth_date', 'first_name', 'id', 'last_name', 'photo_url', 'username'];

function sanitizeBotToken(value) {
  return String(value || '').trim().replace(/^["'](.+)["']$/s, '$1').trim();
}

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function isTelegramConfigured() {
  return Boolean(sanitizeBotToken(process.env.TELEGRAM_BOT_TOKEN) && process.env.TELEGRAM_BOT_USERNAME);
}

function getTelegramBotId() {
  const token = sanitizeBotToken(process.env.TELEGRAM_BOT_TOKEN);
  if (!token) return null;
  const id = token.split(':')[0];
  return /^\d+$/.test(id) ? id : null;
}

function getTelegramBotUsername() {
  const name = process.env.TELEGRAM_BOT_USERNAME;
  return name ? String(name).replace(/^@/, '').trim() : '';
}

/**
 * Verifies a Telegram Login Widget payload.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function verifyTelegramAuth(payload, botToken, options = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'missing' };
  }
  const token = sanitizeBotToken(botToken);
  if (!token) {
    return { ok: false, reason: 'not_configured' };
  }

  const hash = typeof payload.hash === 'string' ? payload.hash : '';
  if (!hash || !payload.id || !payload.auth_date) {
    return { ok: false, reason: 'invalid' };
  }

  const authDate = Number(payload.auth_date);
  const maxAge = Number.isFinite(options.maxAgeSeconds)
    ? options.maxAgeSeconds
    : DEFAULT_MAX_AGE_SECONDS;
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: 'invalid' };
  }
  if (Math.floor(Date.now() / 1000) - authDate > maxAge) {
    return { ok: false, reason: 'expired' };
  }

  // Only Telegram-signed widget fields. Extra body keys like referralCode/redirect
  // must not enter the HMAC, or a valid login is rejected as invalid.
  const dataCheckString = TELEGRAM_LOGIN_FIELDS
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('\n');

  const secret = crypto.createHash('sha256').update(token).digest();
  const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const expected = Buffer.from(hmac, 'hex');
  const received = Buffer.from(hash, 'hex');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true };
}

module.exports = {
  isGoogleConfigured,
  isTelegramConfigured,
  getTelegramBotId,
  getTelegramBotUsername,
  verifyTelegramAuth
};
