const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Challenge = require('../models/Challenge');
const authenticateToken = require('../middleware/authenticateToken');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const { isSuperAdminUserId } = require('../constants/superAdmin');
const { fetchAdminUsers } = require('../utils/adminUsersService');
const { deleteUserFromSystem } = require('../utils/deleteUserService');
const { fetchAdminMissions } = require('../utils/adminMissionsService');
const { deleteMissionFromSystem } = require('../utils/deleteMissionService');

const router = express.Router();

const ALLOWED_STATUSES = new Set(['active', 'disabled']);

router.get('/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const searchQuery = typeof search === 'string' && search.trim() ? search.trim() : null;

    const result = await fetchAdminUsers(User, {
      searchQuery,
      page,
      limit
    });

    res.json(result);
  } catch (error) {
    console.error('Admin users list error:', error);
    res.status(500).json({
      message: 'Error fetching users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.patch('/users/:id/status', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    if (!ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Status must be active or disabled' });
    }

    if (isSuperAdminUserId(id)) {
      return res.status(400).json({ message: 'Cannot change status of the super admin' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    ).select('_id status');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      id: String(user._id),
      status: user.status === 'disabled' ? 'disabled' : 'active'
    });
  } catch (error) {
    console.error('Admin user status update error:', error);
    res.status(500).json({
      message: 'Error updating user status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.delete('/users/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await deleteUserFromSystem(req.params.id);
    res.json({ message: 'User deleted', ...result });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('Admin user delete error:', error);
    }
    res.status(status).json({
      message: error.message || 'Error deleting user',
      error: process.env.NODE_ENV === 'development' && status >= 500 ? error.message : undefined
    });
  }
});

router.get('/missions', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const searchQuery = typeof search === 'string' && search.trim() ? search.trim() : null;

    const result = await fetchAdminMissions(Challenge, {
      searchQuery,
      page,
      limit
    });

    res.json(result);
  } catch (error) {
    console.error('Admin missions list error:', error);
    res.status(500).json({
      message: 'Error fetching missions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.patch('/missions/:id/visibility', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { visibility } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid mission id' });
    }

    if (typeof visibility !== 'boolean') {
      return res.status(400).json({ message: 'Visibility must be a boolean' });
    }

    const challenge = await Challenge.findByIdAndUpdate(
      id,
      { visibility },
      { new: true, runValidators: true }
    ).select('_id visibility');

    if (!challenge) {
      return res.status(404).json({ message: 'Mission not found' });
    }

    res.json({
      id: String(challenge._id),
      visibility: challenge.visibility !== false
    });
  } catch (error) {
    console.error('Admin mission visibility update error:', error);
    res.status(500).json({
      message: 'Error updating mission visibility',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.delete('/missions/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await deleteMissionFromSystem(req.params.id);
    res.json({ message: 'Mission deleted', ...result });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('Admin mission delete error:', error);
    }
    res.status(status).json({
      message: error.message || 'Error deleting mission',
      error: process.env.NODE_ENV === 'development' && status >= 500 ? error.message : undefined
    });
  }
});

module.exports = router;
