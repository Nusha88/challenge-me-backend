const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Challenge = require('../models/Challenge');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendPasswordResetEmail } = require('../utils/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// JWT middleware (for future use)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Get all users
router.get('/users', async (req, res) => {
  try {
    if (!User) {
      console.error('User model is not defined');
      return res.status(500).json({
        message: 'Database model error',
        error: 'User model not found'
      });
    }
    
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 21;
    const skip = (page - 1) * limit;
    
    // Search parameter
    const searchQuery = req.query.search ? req.query.search.trim() : null;
    
    // Build query with optional search filter
    const userQuery = {};
    if (searchQuery) {
      userQuery.name = { $regex: searchQuery, $options: 'i' }; // Case-insensitive search
    }
    
    // Get total count for pagination (with search filter if applicable)
    const totalUsers = await User.countDocuments(userQuery);
    
    // Fetch users with optional search filter, sorted by createdAt descending (we'll sort by challengeCount after getting counts)
    const users = await User.find(userQuery, {
      name: 1,
      email: 1,
      avatarUrl: 1,
      createdAt: 1,
      _id: 1
    }).sort({ createdAt: -1 });
    
    // Get challenge counts for each user (excluding private challenges)
    const usersWithCounts = await Promise.all(users.map(async (user) => {
      const challengeCount = await Challenge.countDocuments({
        $or: [
          { owner: user._id },
          { 'participants.userId': user._id }
        ],
        privacy: { $ne: 'private' } // Exclude private challenges
      });
      return {
        ...user.toObject(),
        challengeCount
      };
    }));
    
    // Sort by challengeCount descending
    usersWithCounts.sort((a, b) => {
      const countA = a.challengeCount || 0;
      const countB = b.challengeCount || 0;
      return countB - countA;
    });
    
    // Apply pagination after sorting
    const paginatedUsers = usersWithCounts.slice(skip, skip + limit);
    const hasMore = skip + limit < usersWithCounts.length;
    
    res.json({
      message: 'Users retrieved successfully',
      users: paginatedUsers,
      pagination: {
        page,
        limit,
        total: totalUsers,
        hasMore
      }
    });
  } catch (error) {
    console.error('Error in /users endpoint:', error);
    res.status(500).json({
      message: 'Error fetching users',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'All fields are required'
      });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        message: 'Invalid email format'
      });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters'
      });
    }
    // Check for duplicate name or email
    const existingUser = await User.findOne({ $or: [{ name }, { email: email.trim().toLowerCase() }] });
    if (existingUser) {
      if (existingUser.name === name) {
        return res.status(409).json({ message: 'A user with this name already exists' });
      }
      if (existingUser.email === email.trim().toLowerCase()) {
        return res.status(409).json({ message: 'A user with this email already exists' });
      }
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email: email.trim().toLowerCase(),
      avatarUrl: req.body.avatarUrl || '',
      password: hashedPassword,
      xp: 0
    });
    await user.save();
    // Generate JWT
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        xp: user.xp || 0,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      message: 'Error registering user',
      error: error.message
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    // Generate JWT
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        xp: user.xp || 0,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

// Get current user's profile (protected)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, {
      name: 1,
      email: 1,
      avatarUrl: 1,
      xp: 1,
      createdAt: 1,
      _id: 1
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching profile', error: error.message });
  }
});

// Award daily 100% bonus XP (+50) once per UTC day
router.post('/xp/daily-bonus', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const todayStr = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const alreadyAwarded = Array.isArray(user.xpDailyBonusDates) && user.xpDailyBonusDates.includes(todayStr);

    if (alreadyAwarded) {
      return res.json({
        awarded: false,
        xp: user.xp || 0,
        date: todayStr
      });
    }

    user.xp = (user.xp || 0) + 50;
    user.xpDailyBonusDates = [...(user.xpDailyBonusDates || []), todayStr];
    await user.save();

    res.json({
      awarded: true,
      xpGained: 50,
      xp: user.xp || 0,
      date: todayStr,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        xp: user.xp || 0,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error awarding daily bonus XP:', error);
    res.status(500).json({ message: 'Error awarding daily bonus XP', error: error.message });
  }
});

// Forgot password endpoint
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
    }
    // Generate reset token
    const crypto = require('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(resetTokenExpiry);
    await user.save();
    
    // Send password reset email
    try {
      const origin = req.headers.origin || req.headers.referer || null;
      await sendPasswordResetEmail(user.email, resetToken, user.name, origin);
      console.log(`Password reset email sent to ${user.email}`);
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
      // Still return success to user for security (don't reveal if email failed)
      // The token is still saved, so they can request again if needed
    }
    
    res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Error processing forgot password request', error: error.message });
  }
});

// Reset password endpoint
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }
    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Error resetting password', error: error.message });
  }
});

// Update current user's profile (protected)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const updates = {};
    const { name, email, avatarUrl } = req.body;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'Name must be provided' });
      }
      updates.name = name.trim();
    }

    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      const normalizedEmail = email.trim().toLowerCase();
      // Check if email is already taken by another user
      const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: req.user.id } });
      if (existingUser) {
        return res.status(409).json({ message: 'A user with this email already exists' });
      }
      updates.email = normalizedEmail;
    }

    if (avatarUrl !== undefined) {
      if (avatarUrl && typeof avatarUrl !== 'string') {
        return res.status(400).json({ message: 'Avatar URL must be a string' });
      }
      updates.avatarUrl = avatarUrl;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, select: 'name email avatarUrl createdAt _id' }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
});

// Get today's daily checklist
router.get('/daily-checklist/today', authenticateToken, async (req, res) => {
    try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Use client-local day when provided to avoid timezone bugs (yesterday showing as today).
    // Headers:
    // - x-client-day: "YYYY-MM-DD" in the CLIENT'S local calendar
    // - x-client-tz-offset: minutes from UTC (Date.getTimezoneOffset())
    function getClientDayRange(dayOffset = 0) {
      const rawDay = req.headers['x-client-day'];
      const rawOffset = req.headers['x-client-tz-offset'];
      const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;
      const dayStr = typeof rawDay === 'string' ? rawDay : null;

      // Fallback: old behavior (UTC day)
      if (!dayStr || !/^\d{4}-\d{2}-\d{2}$/.test(dayStr) || tzOffsetMin === null) {
        const startUtc = new Date();
        startUtc.setUTCHours(0, 0, 0, 0);
        startUtc.setUTCMilliseconds(0);
        startUtc.setUTCDate(startUtc.getUTCDate() + dayOffset);
        const endUtc = new Date(startUtc);
        endUtc.setUTCDate(endUtc.getUTCDate() + 1);
        return { startUtc, endUtc };
      }

      const [y, m, d] = dayStr.split('-').map(Number);
      // local midnight -> UTC = Date.UTC(...) + tzOffsetMin minutes
      const startMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
      const startUtc = new Date(startMs);
      const endUtc = new Date(startMs + 24 * 60 * 60 * 1000);
      // Apply dayOffset in local-day units
      if (dayOffset !== 0) {
        startUtc.setTime(startUtc.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        endUtc.setTime(endUtc.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      }
      return { startUtc, endUtc };
    }

    const { startUtc: todayStartUtc, endUtc: todayEndUtc } = getClientDayRange(0);

    // Find checklist for today - use a range to handle timezone differences
    // Check if checklist date falls within client's "today" window in UTC
    const todayChecklists = user.dailyChecklists.filter(checklist => {
      if (!checklist.date) return false;
      
      const checklistDate = new Date(checklist.date);
      const t = checklistDate.getTime();
      return t >= todayStartUtc.getTime() && t < todayEndUtc.getTime();
    });

    // Return the most recent one if multiple exist (shouldn't happen after fix, but handle gracefully)
    let todayChecklist = todayChecklists.length > 0 
      ? todayChecklists.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
      : null;

    if (todayChecklist) {
      res.json({ checklist: todayChecklist });
    } else {
      res.json({ checklist: null });
    }
    } catch (error) {
    console.error('Error fetching today\'s checklist:', error);
    res.status(500).json({ message: 'Error fetching checklist', error: error.message });
  }
});

// Update today's daily checklist
router.put('/daily-checklist/today', authenticateToken, async (req, res) => {
  try {
    const { tasks } = req.body;
    
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ message: 'Tasks must be an array' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Use client-local day when provided to avoid timezone bugs.
    function getClientDayRange(dayOffset = 0) {
      const rawDay = req.headers['x-client-day'];
      const rawOffset = req.headers['x-client-tz-offset'];
      const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;
      const dayStr = typeof rawDay === 'string' ? rawDay : null;

      // Fallback: old behavior (UTC day)
      if (!dayStr || !/^\d{4}-\d{2}-\d{2}$/.test(dayStr) || tzOffsetMin === null) {
        const startUtc = new Date();
        startUtc.setUTCHours(0, 0, 0, 0);
        startUtc.setUTCMilliseconds(0);
        startUtc.setUTCDate(startUtc.getUTCDate() + dayOffset);
        const endUtc = new Date(startUtc);
        endUtc.setUTCDate(endUtc.getUTCDate() + 1);
        return { startUtc, endUtc };
      }

      const [y, m, d] = dayStr.split('-').map(Number);
      const startMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
      const startUtc = new Date(startMs);
      const endUtc = new Date(startMs + 24 * 60 * 60 * 1000);
      if (dayOffset !== 0) {
        startUtc.setTime(startUtc.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        endUtc.setTime(endUtc.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      }
      return { startUtc, endUtc };
    }

    const { startUtc: todayStartUtc, endUtc: todayEndUtc } = getClientDayRange(0);

    // Find today's existing checklist (if any) to award XP for newly completed tasks
    const existingTodayChecklist = user.dailyChecklists.find(checklist => {
      if (!checklist.date) return false;
      const t = new Date(checklist.date).getTime();
      return t >= todayStartUtc.getTime() && t < todayEndUtc.getTime();
    });

    const prevDoneCount = existingTodayChecklist?.tasks
      ? existingTodayChecklist.tasks.filter(t => t && t.done).length
      : 0;
    const newDoneCount = tasks.filter(t => t && t.done).length;
    const newlyCompleted = Math.max(0, newDoneCount - prevDoneCount);
    const xpGained = newlyCompleted * 5;

    // Remove any duplicate checklists for today (cleanup) using client's today window
    const checklistsToKeep = user.dailyChecklists.filter(checklist => {
      if (!checklist.date) return true;
      const t = new Date(checklist.date).getTime();
      return !(t >= todayStartUtc.getTime() && t < todayEndUtc.getTime());
    });

    // Add today's checklist (store at the start of the client's day window in UTC)
    checklistsToKeep.push({
      date: todayStartUtc,
      tasks: tasks
    });

    // Update user with the cleaned list
    user.dailyChecklists = checklistsToKeep;
    if (xpGained > 0) {
      user.xp = (user.xp || 0) + xpGained;
    }
    
    // Check for 7-day streak milestone and award XP
    const habitChallenges = await Challenge.find({
      challengeType: 'habit',
      'participants.userId': user._id
    });
    
    // Calculate current streak
    let currentStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Helper function to check if a day was completed
    const checkDayCompletion = (date) => {
      const dateStr = date.toISOString().slice(0, 10);
      
      // Check checklist
      const checklistForDate = user.dailyChecklists.find(c => {
        if (!c.date) return false;
        const checklistDate = new Date(c.date);
        checklistDate.setHours(0, 0, 0, 0);
        return checklistDate.getTime() === date.getTime();
      });
      
      const hasCompletedChecklistTask = checklistForDate && checklistForDate.tasks && checklistForDate.tasks.length > 0
        ? checklistForDate.tasks.some(task => task.done === true)
        : false;
      
      // Check habit challenges
      let hasCompletedChallenge = false;
      for (const challenge of habitChallenges) {
        if (!challenge.participants || challenge.participants.length === 0) continue;
        
        const participant = challenge.participants.find(p => {
          const pUserId = p.userId?._id || p.userId || p._id;
          return pUserId && pUserId.toString() === user._id.toString();
        });
        
        if (participant && participant.completedDays && Array.isArray(participant.completedDays)) {
          const hasDate = participant.completedDays.some(completedDate => {
            if (!completedDate) return false;
            let completedDateStr = String(completedDate);
            if (completedDateStr.includes('T')) {
              completedDateStr = completedDateStr.split('T')[0];
            }
            completedDateStr = completedDateStr.substring(0, 10);
            return completedDateStr === dateStr;
          });
          
          if (hasDate) {
            hasCompletedChallenge = true;
            break;
          }
        }
      }
      
      return hasCompletedChecklistTask || hasCompletedChallenge;
    };
    
    // Calculate streak starting from today
    let checkDate = new Date(today);
    for (let i = 0; i < 365; i++) {
      if (checkDayCompletion(checkDate)) {
        currentStreak++;
      } else {
        break;
      }
      checkDate.setDate(checkDate.getDate() - 1);
      checkDate.setHours(0, 0, 0, 0);
    }
    
    // Award +50 XP for 7-day streak milestone if not already awarded
    if (currentStreak >= 7 && !user.streakMilestonesAwarded?.includes(7)) {
      user.xp = (user.xp || 0) + 50;
      user.streakMilestonesAwarded = [...(user.streakMilestonesAwarded || []), 7];
      xpGained += 50;
    }
    
    const updatedUser = await user.save();

    // Find and return the checklist we just created
    const updatedChecklist = updatedUser.dailyChecklists.find(checklist => {
      if (!checklist.date) return false;
      const t = new Date(checklist.date).getTime();
      return t >= todayStartUtc.getTime() && t < todayEndUtc.getTime();
    });

    res.json({ 
      message: 'Checklist updated successfully',
      checklist: updatedChecklist,
      xpGained,
      xp: updatedUser.xp || 0,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        avatarUrl: updatedUser.avatarUrl,
        xp: updatedUser.xp || 0,
        createdAt: updatedUser.createdAt
      }
    });
  } catch (error) {
    console.error('Error updating checklist:', error);
    res.status(500).json({ message: 'Error updating checklist', error: error.message });
  }
});

// Get all daily checklists (history)
router.get('/daily-checklist/history', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, 'dailyChecklists');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Group and label by CLIENT local day to avoid "yesterday shown as today" in the journal.
    const rawOffset = req.headers['x-client-tz-offset'];
    const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;

    function toClientDayKey(date) {
      const ms = new Date(date).getTime();
      if (!Number.isFinite(ms)) return null;
      // Convert UTC instant -> client's local clock by subtracting tzOffset minutes
      const localMs = tzOffsetMin === null ? ms : (ms - tzOffsetMin * 60 * 1000);
      const d = new Date(localMs);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    // Keep the most recent checklist per client day
    const byDay = new Map();
    for (const c of user.dailyChecklists || []) {
      if (!c?.date) continue;
      const key = toClientDayKey(c.date);
      if (!key) continue;
      const prev = byDay.get(key);
      if (!prev || new Date(c.date) > new Date(prev.date)) {
        byDay.set(key, c);
      }
    }

    const grouped = Array.from(byDay.entries()).map(([clientDay, checklist]) => ({
      ...checklist.toObject?.() || checklist,
      clientDay
    }));

    // Sort by clientDay descending
    grouped.sort((a, b) => (a.clientDay < b.clientDay ? 1 : a.clientDay > b.clientDay ? -1 : 0));

    res.json({ checklists: grouped });
  } catch (error) {
    console.error('Error fetching checklist history:', error);
    res.status(500).json({ message: 'Error fetching checklist history', error: error.message });
    }
});

// Get tomorrow's daily checklist
router.get('/daily-checklist/tomorrow', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Use client-local day when provided (tomorrow = client today + 1)
    function getClientDayRange(dayOffset = 0) {
      const rawDay = req.headers['x-client-day'];
      const rawOffset = req.headers['x-client-tz-offset'];
      const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;
      const dayStr = typeof rawDay === 'string' ? rawDay : null;

      if (!dayStr || !/^\d{4}-\d{2}-\d{2}$/.test(dayStr) || tzOffsetMin === null) {
        const startUtc = new Date();
        startUtc.setUTCHours(0, 0, 0, 0);
        startUtc.setUTCMilliseconds(0);
        startUtc.setUTCDate(startUtc.getUTCDate() + dayOffset);
        const endUtc = new Date(startUtc);
        endUtc.setUTCDate(endUtc.getUTCDate() + 1);
        return { startUtc, endUtc };
      }

      const [y, m, d] = dayStr.split('-').map(Number);
      const baseStartMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
      const startMs = baseStartMs + dayOffset * 24 * 60 * 60 * 1000;
      const startUtc = new Date(startMs);
      const endUtc = new Date(startMs + 24 * 60 * 60 * 1000);
      return { startUtc, endUtc };
    }

    const { startUtc: tomorrowStartUtc, endUtc: tomorrowEndUtc } = getClientDayRange(1);

    // Find checklist for tomorrow
    const tomorrowChecklists = user.dailyChecklists.filter(checklist => {
      if (!checklist.date) return false;
      const t = new Date(checklist.date).getTime();
      return t >= tomorrowStartUtc.getTime() && t < tomorrowEndUtc.getTime();
    });

    const tomorrowChecklist = tomorrowChecklists.length > 0
      ? tomorrowChecklists[tomorrowChecklists.length - 1]
      : null;

    if (tomorrowChecklist) {
      res.json({ checklist: tomorrowChecklist });
    } else {
      res.json({ checklist: null });
    }
  } catch (error) {
    console.error('Error fetching tomorrow\'s checklist:', error);
    res.status(500).json({ message: 'Error fetching checklist', error: error.message });
  }
});

// Update tomorrow's daily checklist
router.put('/daily-checklist/tomorrow', authenticateToken, async (req, res) => {
  try {
    const { tasks } = req.body;
    
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ message: 'Tasks must be an array' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Use client-local day when provided (tomorrow = client today + 1)
    function getClientDayRange(dayOffset = 0) {
      const rawDay = req.headers['x-client-day'];
      const rawOffset = req.headers['x-client-tz-offset'];
      const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;
      const dayStr = typeof rawDay === 'string' ? rawDay : null;

      if (!dayStr || !/^\d{4}-\d{2}-\d{2}$/.test(dayStr) || tzOffsetMin === null) {
        const startUtc = new Date();
        startUtc.setUTCHours(0, 0, 0, 0);
        startUtc.setUTCMilliseconds(0);
        startUtc.setUTCDate(startUtc.getUTCDate() + dayOffset);
        const endUtc = new Date(startUtc);
        endUtc.setUTCDate(endUtc.getUTCDate() + 1);
        return { startUtc, endUtc };
      }

      const [y, m, d] = dayStr.split('-').map(Number);
      const baseStartMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMin * 60 * 1000;
      const startMs = baseStartMs + dayOffset * 24 * 60 * 60 * 1000;
      const startUtc = new Date(startMs);
      const endUtc = new Date(startMs + 24 * 60 * 60 * 1000);
      return { startUtc, endUtc };
    }

    const { startUtc: tomorrowStartUtc, endUtc: tomorrowEndUtc } = getClientDayRange(1);

    // Remove any duplicate checklists for tomorrow
    const checklistsToKeep = user.dailyChecklists.filter(checklist => {
      if (!checklist.date) return true;
      const t = new Date(checklist.date).getTime();
      return !(t >= tomorrowStartUtc.getTime() && t < tomorrowEndUtc.getTime());
    });

    // Add tomorrow's checklist
    checklistsToKeep.push({
      date: tomorrowStartUtc,
      tasks: tasks
    });

    // Update user with the cleaned list
    user.dailyChecklists = checklistsToKeep;
    const updatedUser = await user.save();

    // Find and return the checklist we just created
    const updatedChecklist = updatedUser.dailyChecklists.find(checklist => {
      if (!checklist.date) return false;
      const t = new Date(checklist.date).getTime();
      return t >= tomorrowStartUtc.getTime() && t < tomorrowEndUtc.getTime();
    });

    res.json({ 
      message: 'Tomorrow\'s checklist updated successfully',
      checklist: updatedChecklist,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        avatarUrl: updatedUser.avatarUrl,
        xp: updatedUser.xp || 0,
        createdAt: updatedUser.createdAt
      }
    });
  } catch (error) {
    console.error('Error updating tomorrow\'s checklist:', error);
    res.status(500).json({ message: 'Error updating checklist', error: error.message });
  }
});

module.exports = router; 