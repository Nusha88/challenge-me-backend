const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { getVapidPublicKey, getVapidDiagnostics } = require('../utils/pushService');

// Middleware to authenticate token - use the same as auth routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  const jwt = require('jsonwebtoken');
  // Use the same JWT_SECRET as auth routes
  const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('[Push] Token verification failed:', err.message);
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Get VAPID public key
router.get('/vapid-public-key', (req, res) => {
  try {
    const publicKey = getVapidPublicKey();
    res.json({ publicKey });
  } catch (error) {
    console.error('[Push] Error getting VAPID public key:', error);
    res.status(500).json({ message: 'Error getting VAPID key', error: error.message });
  }
});

// Diagnostics (fingerprints only) - helps debug BadJwtToken/VAPID mismatch in prod
router.get('/diagnostics', authenticateToken, (req, res) => {
  try {
    const diag = getVapidDiagnostics()
    res.json(diag)
  } catch (error) {
    console.error('[Push] Error getting VAPID diagnostics:', error)
    res.status(500).json({ message: 'Error getting diagnostics', error: error.message })
  }
})

// Subscribe to push notifications
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { subscription } = req.body;
    const userId = req.user.id;
    
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ message: 'Invalid subscription object' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Store push subscription
    user.pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      }
    };

    await user.save();

    res.json({ message: 'Push subscription saved successfully' });
  } catch (error) {
    console.error('[Push] Error saving push subscription:', error);
    res.status(500).json({ message: 'Error saving push subscription', error: error.message });
  }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.pushSubscription = null;
    await user.save();

    res.json({ message: 'Push subscription removed successfully' });
  } catch (error) {
    console.error('Error removing push subscription:', error);
    res.status(500).json({ message: 'Error removing push subscription', error: error.message });
  }
});

// Get push subscription status for the current user
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId, 'pushSubscription');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const hasSubscription = !!user.pushSubscription;
    res.json({ hasSubscription });
  } catch (error) {
    console.error(`[Push] Error checking push subscription status:`, error);
    res.status(500).json({ message: 'Error checking push subscription status', error: error.message });
  }
});

module.exports = router;
