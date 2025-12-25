const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const Challenge = require('../models/Challenge');

// Get all notifications for a user
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, unreadOnly = false } = req.query;

    const query = { userId };
    if (unreadOnly === 'true') {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .populate('fromUserId', 'name avatarUrl')
      .populate('challengeId', 'title')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notifications', error: error.message });
  }
});

// Get unread notification count
router.get('/:userId/unread-count', async (req, res) => {
  try {
    const { userId } = req.params;
    const count = await Notification.countDocuments({ userId, read: false });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching unread count', error: error.message });
  }
});

// Mark notification as read
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findByIdAndUpdate(
      id,
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read', notification });
  } catch (error) {
    res.status(500).json({ message: 'Error updating notification', error: error.message });
  }
});

// Mark all notifications as read for a user
router.put('/:userId/read-all', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    res.json({ message: 'All notifications marked as read', updatedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: 'Error updating notifications', error: error.message });
  }
});

// Delete a notification
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findByIdAndDelete(id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting notification', error: error.message });
  }
});

module.exports = router;

