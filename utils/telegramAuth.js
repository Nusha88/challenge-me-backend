const crypto = require('crypto');

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);
}

function getTelegramBotId() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const id = String(token).split(':')[0];
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
  if (!botToken) {
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

  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== 'hash' && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('\n');

  const secret = crypto.createHash('sha256').update(String(botToken)).digest();
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
