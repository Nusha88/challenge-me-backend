const webpush = require('web-push');
const User = require('../models/User');

// VAPID keys - Must be stored in environment variables
// Generate keys using: node scripts/generate-vapid-keys.js
// Trim whitespace to avoid issues with environment variable formatting
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim()
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim()
const VAPID_CONTACT_EMAIL = (process.env.VAPID_CONTACT_EMAIL || 'mailto:your-email@example.com').trim()

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
  getVapidPublicKey
};
