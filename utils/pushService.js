const webpush = require('web-push');
const User = require('../models/User');

// VAPID keys - Must be stored in environment variables
// Generate keys using: node scripts/generate-vapid-keys.js
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:your-email@example.com'

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn('WARNING: VAPID keys not found in environment variables. Push notifications will not work.');
  console.warn('Generate keys using: node scripts/generate-vapid-keys.js');
  console.warn('Then add them to your .env file.');
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
      console.log('VAPID keys not configured, skipping push notification');
      return;
    }

    const user = await User.findById(userId);
    
    if (!user || !user.pushSubscription) {
      console.log(`No push subscription found for user ${userId}`);
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
    console.log(`Push notification sent to user ${userId}`);
  } catch (error) {
    console.error(`Error sending push notification to user ${userId}:`, error);
    
    // If subscription is invalid or VAPID keys don't match, remove it
    if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 403) {
      if (error.statusCode === 403) {
        console.log(`[Push] VAPID key mismatch for user ${userId} - subscription was created with different keys`);
        console.log(`[Push] User needs to re-subscribe with the current VAPID keys`);
      }
      console.log(`Removing invalid push subscription for user ${userId}`);
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
