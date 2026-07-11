const jwt = require('jsonwebtoken');

const EMAIL_UNSUBSCRIBE_TYPES = Object.freeze({
  WEEKLY_CHRONICLE: 'weekly-chronicle',
  REACTIVATION: 'reactivation'
});

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }
  return process.env.JWT_SECRET;
}

function createEmailUnsubscribeToken(userId, type) {
  if (!userId || !type) {
    throw new Error('userId and type are required to create an unsubscribe token');
  }

  return jwt.sign(
    {
      purpose: 'email-unsubscribe',
      type,
      sub: String(userId)
    },
    getJwtSecret(),
    { expiresIn: '365d' }
  );
}

function verifyEmailUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return null;

  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (payload?.purpose !== 'email-unsubscribe') return null;
    if (!Object.values(EMAIL_UNSUBSCRIBE_TYPES).includes(payload.type)) return null;
    if (!payload.sub) return null;

    return {
      userId: String(payload.sub),
      type: payload.type
    };
  } catch {
    return null;
  }
}

function getEmailApiBaseUrl() {
  if (process.env.EMAIL_API_BASE_URL) {
    return process.env.EMAIL_API_BASE_URL.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    return (process.env.API_PUBLIC_URL || 'https://challenge-me-backend-frh7.onrender.com/api').replace(/\/$/, '');
  }

  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/api`;
}

function buildUnsubscribeUrl(userId, type) {
  const token = createEmailUnsubscribeToken(userId, type);
  const apiBase = getEmailApiBaseUrl();
  return `${apiBase}/auth/email/unsubscribe?token=${encodeURIComponent(token)}&format=html`;
}

module.exports = {
  EMAIL_UNSUBSCRIBE_TYPES,
  createEmailUnsubscribeToken,
  verifyEmailUnsubscribeToken,
  buildUnsubscribeUrl,
  getEmailApiBaseUrl
};
