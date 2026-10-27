const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { serializeUserForClient } = require('./userSerializer');

function isSafeHttpUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  return /^https?:\/\//i.test(url.trim());
}
const {
  generateUniqueReferralCode,
  resolveReferrerByCode,
  createPendingReferral
} = require('./referralService');
const { sendNewUserRegistrationNotifyEmail } = require('./emailService');

const STATE_TTL = '10m';
const PROVIDERS = new Set(['google', 'telegram']);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

function getFrontendUrl() {
  return String(process.env.FRONTEND_URL || process.env.EMAIL_FRONTEND_URL || 'http://localhost:5173')
    .replace(/\/$/, '');
}

function sanitizeRedirect(value) {
  if (typeof value !== 'string') return '/today';
  if (!value.startsWith('/') || value.startsWith('//')) return '/today';
  return value;
}

function signOAuthState(payload) {
  return jwt.sign(
    {
      referralCode: payload.referralCode || '',
      redirect: sanitizeRedirect(payload.redirect),
      demo: Boolean(payload.demo)
    },
    getJwtSecret(),
    { expiresIn: STATE_TTL }
  );
}

function parseOAuthState(state) {
  if (!state || typeof state !== 'string') {
    return { referralCode: '', redirect: '/today', demo: false };
  }
  try {
    const decoded = jwt.verify(state, getJwtSecret());
    return {
      referralCode: typeof decoded.referralCode === 'string' ? decoded.referralCode : '',
      redirect: sanitizeRedirect(decoded.redirect),
      demo: Boolean(decoded.demo)
    };
  } catch {
    return { referralCode: '', redirect: '/today', demo: false };
  }
}

function signUserToken(user) {
  return jwt.sign({ id: user._id, name: user.name }, getJwtSecret(), { expiresIn: '7d' });
}

function hasIdentity(user, provider, providerId) {
  return (user.identities || []).some(
    (item) => item.provider === provider && String(item.providerId) === String(providerId)
  );
}

async function attachIdentity(user, provider, providerId) {
  if (!PROVIDERS.has(provider) || !providerId) return user;
  if (hasIdentity(user, provider, providerId)) return user;
  user.identities = user.identities || [];
  user.identities.push({ provider, providerId: String(providerId), linkedAt: new Date() });
  return user;
}

async function createSocialUser({ name, email, avatarUrl, provider, providerId, referralCode }) {
  const newReferralCode = await generateUniqueReferralCode();
  const referrer = referralCode ? await resolveReferrerByCode(referralCode) : null;
  const safeName = String(name || '').trim() || 'Hero';
  const user = new User({
    name: safeName.slice(0, 80),
    email: email || undefined,
    avatarUrl: avatarUrl || '',
    identities: [{ provider, providerId: String(providerId), linkedAt: new Date() }],
    xp: 0,
    sparks: 0,
    referralCode: newReferralCode,
    referredBy: referrer?._id || null
  });
  await user.save();

  if (referrer) {
    await createPendingReferral(referrer._id, user._id);
  }

  try {
    await sendNewUserRegistrationNotifyEmail({
      userName: user.name,
      userEmail: user.email || `${provider}:${providerId}`,
      registeredAt: user.createdAt
    });
  } catch (emailError) {
    console.error('Failed to send registration notify email:', emailError);
  }

  return user;
}

async function findByIdentity(provider, providerId) {
  return User.findOne({
    identities: { $elemMatch: { provider, providerId: String(providerId) } }
  });
}

function assertActive(user) {
  if (user && user.status === 'disabled') {
    const error = new Error('Account is disabled');
    error.status = 403;
    throw error;
  }
}

async function upsertSocialUser({
  provider,
  providerId,
  name,
  email,
  emailVerified,
  avatarUrl,
  referralCode
}) {
  if (!PROVIDERS.has(provider) || !providerId) {
    const error = new Error('Invalid social login');
    error.status = 400;
    throw error;
  }

  let user = await findByIdentity(provider, providerId);
  if (user) {
    assertActive(user);
    return { user, isNew: false };
  }

  const normalizedEmail = emailVerified && email
    ? String(email).trim().toLowerCase()
    : null;

  if (normalizedEmail) {
    user = await User.findOne({ email: normalizedEmail });
    if (user) {
      assertActive(user);
      await attachIdentity(user, provider, providerId);
      if (!user.avatarUrl && avatarUrl) user.avatarUrl = avatarUrl;
      await user.save();
      return { user, isNew: false };
    }
  }

  user = await createSocialUser({
    name,
    email: normalizedEmail || undefined,
    avatarUrl,
    provider,
    providerId,
    referralCode
  });
  return { user, isNew: true };
}

async function linkIdentityToUser(userId, provider, providerId, extras = {}) {
  const existing = await findByIdentity(provider, providerId);
  if (existing && String(existing._id) !== String(userId)) {
    const error = new Error('This account is already linked to another hero');
    error.status = 409;
    throw error;
  }

  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  assertActive(user);
  await attachIdentity(user, provider, providerId);
  if (!user.avatarUrl && extras.avatarUrl) user.avatarUrl = extras.avatarUrl;
  await user.save();
  return user;
}

function authPayload(user, isNew = false, redirect = '/today') {
  return {
    message: isNew ? 'User registered successfully' : 'Login successful',
    token: signUserToken(user),
    isNew: Boolean(isNew),
    redirect: sanitizeRedirect(redirect),
    user: serializeUserForClient(user)
  };
}

function pickGoogleProfile(profile) {
  const emailEntry = Array.isArray(profile?.emails) ? profile.emails[0] : null;
  const json = profile?._json || {};
  const email = emailEntry?.value || json.email || '';
  const emailVerified = emailEntry?.verified !== false && json.email_verified !== false && Boolean(email);
  const photo = Array.isArray(profile?.photos) ? profile.photos[0]?.value : json.picture;
  return {
    providerId: String(profile.id),
    name: profile.displayName || json.name || '',
    email,
    emailVerified,
    avatarUrl: isSafeHttpUrl(photo) ? photo : ''
  };
}

function pickTelegramProfile(payload) {
  const first = String(payload.first_name || '').trim();
  const last = String(payload.last_name || '').trim();
  const name = [first, last].filter(Boolean).join(' ') || payload.username || 'Hero';
  const photo = payload.photo_url;
  return {
    providerId: String(payload.id),
    name,
    email: null,
    emailVerified: false,
    avatarUrl: isSafeHttpUrl(photo) ? photo : ''
  };
}

module.exports = {
  getFrontendUrl,
  sanitizeRedirect,
  signOAuthState,
  parseOAuthState,
  signUserToken,
  upsertSocialUser,
  linkIdentityToUser,
  authPayload,
  pickGoogleProfile,
  pickTelegramProfile
};
