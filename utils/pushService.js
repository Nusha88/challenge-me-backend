const webpush = require('web-push');
const User = require('../models/User');
const crypto = require('crypto')

// VAPID keys - Must be stored in environment variables
// Generate keys using: node scripts/generate-vapid-keys.js
// Trim whitespace to avoid issues with environment variable formatting
function sanitizeEnvValue(value) {
  const v = (value ?? '').toString().trim()
  // Render/env UI sometimes encourages quoting; strip one layer of wrapping quotes if present
  return v.replace(/^["'](.+)["']$/s, '$1').trim()
}

const VAPID_PUBLIC_KEY = sanitizeEnvValue(process.env.VAPID_PUBLIC_KEY)
const VAPID_PRIVATE_KEY = sanitizeEnvValue(process.env.VAPID_PRIVATE_KEY)

function isValidVapidSubject(subject) {
  if (!subject) return false
  const s = subject.trim()
  if (s.startsWith('mailto:')) {
    const email = s.slice('mailto:'.length).trim()
    // simple sanity check: local@domain.tld
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }
  // Alternatively allowed: URL
  return /^https?:\/\/.+/i.test(s)
}

let VAPID_CONTACT_EMAIL = sanitizeEnvValue(process.env.VAPID_CONTACT_EMAIL || 'mailto:your-email@example.com')
if (!isValidVapidSubject(VAPID_CONTACT_EMAIL)) {
  console.warn(`[Push Service] WARNING: VAPID_CONTACT_EMAIL is not a valid VAPID subject ("${VAPID_CONTACT_EMAIL}").`)
  console.warn('[Push Service] Falling back to "mailto:your-email@example.com" to avoid BadJwtToken from push providers.')
  VAPID_CONTACT_EMAIL = 'mailto:your-email@example.com'
}

function normalizeBase64Url(str) {
  return (str || '').trim().replace(/=+$/g, '')
}

function base64UrlToBuffer(base64Url) {
  const padded = normalizeBase64Url(base64Url)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const padLength = (4 - (padded.length % 4)) % 4
  const base64 = padded + '='.repeat(padLength)
  return Buffer.from(base64, 'base64')
}

function bufferToBase64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function derivePublicKeyFromPrivateKey(privateKeyBase64Url) {
  // VAPID keys are on P-256 (prime256v1)
  // Private key is 32 bytes, public key is uncompressed point 65 bytes.
  const priv = base64UrlToBuffer(privateKeyBase64Url)
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.setPrivateKey(priv)
  const pub = ecdh.getPublicKey(null, 'uncompressed')
  return bufferToBase64Url(pub)
}

function fingerprintBase64Url(str) {
  if (!str) return null
  const normalized = normalizeBase64Url(str)
  const hash = crypto.createHash('sha256').update(normalized).digest('hex')
  // short fingerprint, enough to compare across environments without leaking secrets
  return `${hash.slice(0, 12)}…${hash.slice(-12)}`
}

function getVapidDiagnostics() {
  const configured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
  let derivedPublic = null
  let matches = null
  let validationError = null

  if (configured) {
    try {
      derivedPublic = derivePublicKeyFromPrivateKey(VAPID_PRIVATE_KEY)
      matches = normalizeBase64Url(derivedPublic) === normalizeBase64Url(VAPID_PUBLIC_KEY)
    } catch (e) {
      validationError = e.message
    }
  }

  return {
    configured,
    publicKeyLength: VAPID_PUBLIC_KEY ? VAPID_PUBLIC_KEY.length : 0,
    privateKeyLength: VAPID_PRIVATE_KEY ? VAPID_PRIVATE_KEY.length : 0,
    publicKeyFingerprint: fingerprintBase64Url(VAPID_PUBLIC_KEY),
    derivedPublicFingerprint: derivedPublic ? fingerprintBase64Url(derivedPublic) : null,
    matches,
    validationError,
    contact: VAPID_CONTACT_EMAIL || null
  }
}

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn('[Push Service] WARNING: VAPID keys not found in environment variables. Push notifications will not work.');
  console.warn('[Push Service] Generate keys using: node scripts/generate-vapid-keys.js');
  console.warn('[Push Service] Then add them to your .env file.');
} else {
  // Validate key format (VAPID keys should be base64url encoded, ~87 chars for public, ~43 chars for private)
  if (VAPID_PUBLIC_KEY.length < 80 || VAPID_PUBLIC_KEY.length > 100) {
    console.warn(`[Push Service] WARNING: VAPID public key length seems incorrect (${VAPID_PUBLIC_KEY.length} chars). Expected ~87 chars.`);
  }
  if (VAPID_PRIVATE_KEY.length < 40 || VAPID_PRIVATE_KEY.length > 50) {
    console.warn(`[Push Service] WARNING: VAPID private key length seems incorrect (${VAPID_PRIVATE_KEY.length} chars). Expected ~43 chars.`);
  }

  // Validate that public/private keys are a matching pair (common cause of 403 BadJwtToken)
  try {
    const derivedPublic = derivePublicKeyFromPrivateKey(VAPID_PRIVATE_KEY)
    if (normalizeBase64Url(derivedPublic) !== normalizeBase64Url(VAPID_PUBLIC_KEY)) {
      const pub = normalizeBase64Url(VAPID_PUBLIC_KEY)
      const der = normalizeBase64Url(derivedPublic)
      console.warn('[Push Service] WARNING: VAPID public/private keys do NOT match. Push sends will fail with 403 BadJwtToken.')
      console.warn(`[Push Service] Env public key:   ${pub.slice(0, 10)}…${pub.slice(-10)}`)
      console.warn(`[Push Service] Derived public:   ${der.slice(0, 10)}…${der.slice(-10)}`)
    }
  } catch (e) {
    console.warn('[Push Service] WARNING: Could not validate VAPID key pair:', e.message)
  }
}

const VAPID_KEYS = {
  publicKey: VAPID_PUBLIC_KEY,
  privateKey: VAPID_PRIVATE_KEY
};

// Set VAPID details (only if keys are available)
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_CONTACT_EMAIL,
    VAPID_KEYS.publicKey,
    VAPID_KEYS.privateKey
  );
} else {
  console.warn('[Push Service] VAPID keys are missing - push notifications will not work');
}

/**
 * Send push notification to a user
 * @param {String} userId - User ID to send notification to
 * @param {Object} notificationData - Notification payload
 * @returns {Promise<void>}
 */
async function sendPushNotification(userId, notificationData) {
  try {
    // Check if VAPID keys are configured
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return;
    }

    // Ensure VAPID keys are set (in case module was reloaded or keys changed)
    webpush.setVapidDetails(
      VAPID_CONTACT_EMAIL,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    const user = await User.findById(userId);
    
    if (!user || !user.pushSubscription) {
      return;
    }

    const payload = JSON.stringify({
      title: notificationData.title,
      body: notificationData.body,
      icon: notificationData.icon || '/icons/icon.png',
      badge: notificationData.badge || '/icons/icon.png',
      data: notificationData.data || {},
      tag: notificationData.tag || 'notification',
      requireInteraction: false,
      silent: false
    });

    await webpush.sendNotification(user.pushSubscription, payload);
  } catch (error) {
    console.error(`[Push] Error sending push notification to user ${userId}:`, error);
    
    // If subscription is invalid or VAPID keys don't match, remove it
    if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 403) {
      if (error.statusCode === 403) {
        const body = typeof error.body === 'string' ? error.body : ''
        if (body.includes('BadJwtToken') || body.includes('credentials') || body.includes('VAPID')) {
          console.warn(`[Push] 403 likely due to VAPID mismatch/rotation for user ${userId}. Removing stored subscription.`)
        }
      }
      await User.findByIdAndUpdate(userId, { pushSubscription: null });
    }
  }
}

/**
 * Get VAPID public key for client subscription
 * @returns {String} VAPID public key or null if not configured
 */
function getVapidPublicKey() {
  if (!VAPID_KEYS.publicKey) {
    throw new Error('VAPID keys not configured. Please generate keys and add them to environment variables.');
  }
  return VAPID_KEYS.publicKey;
}

module.exports = {
  sendPushNotification,
  getVapidPublicKey,
  getVapidDiagnostics
};
