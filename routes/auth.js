const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Challenge = require('../models/Challenge');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  sendPasswordResetEmail,
  sendPasswordResetSuccessEmail,
  sendNewUserRegistrationNotifyEmail,
  sendWeeklyChronicleEmail,
  sendReactivationEmail
} = require('../utils/emailService');
const { buildWeeklyChronicleReport, resolveUserReportLanguage } = require('../utils/weeklyChronicleReport');
const registerRateLimiter = require('../middleware/registerRateLimiter');

const {
  getClientDayRange,
  getClientLocalHour,
  toClientDayKey,
  findLatestChecklistInRange,
  serializeChecklistForClientDay
} = require('../utils/dateHelpers');
const {
  findByClientDay,
  upsertChecklist,
  findManyByLocalDates,
  hasCompletedChecklistTask,
  getChecklistHistory
} = require('../utils/dailyChecklistService');
const {
  awardDailyFullCompletionXp,
  awardChecklistTaskXp,
  awardStreakMilestoneXp
} = require('../utils/xpService');
const {
  awardChecklistTaskSparks,
  awardStreakMilestoneSparks,
  awardManifestSparks,
  spendSparksOnce
} = require('../utils/sparksService');
const {
  buildChecklistTaskAwardKey,
  buildResultActionChecklistTaskKey,
  SPARKS_AMOUNTS,
  buildFreezeDaySparksKey
} = require('../constants/sparksRules');
const {
  findChallengeParticipant,
  isChallengeFinished,
  isDayEffectiveCompleted,
  appendUniqueParticipantDay,
  isDateScheduledForChallenge
} = require('../utils/challengeHelpers');
const { buildRewardPayload } = require('../utils/rewardResponse');
const { fetchPaginatedUsers } = require('../utils/usersListService');
const {
  generateUniqueReferralCode,
  resolveReferrerByCode,
  createPendingReferral,
  getReferralStatsForUser,
  getReferralProfileFlags
} = require('../utils/referralService');

function serializeUserForClient(user) {
  if (!user) return null;
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    xp: user.xp || 0,
    sparks: user.sparks || 0,
    createdAt: user.createdAt
  };
}

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
    
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 21;
    const searchQuery = req.query.search ? req.query.search.trim() : null;

    const { users, totalUsers, pagination } = await fetchPaginatedUsers(User, {
      searchQuery,
      page,
      limit
    });

    res.json({
      message: 'Users retrieved successfully',
      users,
      totalUsers,
      pagination
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

// Get user by ID
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!User) {
      console.error('User model is not defined');
      return res.status(500).json({
        message: 'Database model error',
        error: 'User model not found'
      });
    }
    
    const user = await User.findById(id, {
      name: 1,
      email: 1,
      avatarUrl: 1,
      xp: 1,
      sparks: 1,
      createdAt: 1,
      _id: 1,
      dailyChecklists: 1
    }).lean();
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get challenge count for the user (excluding private challenges)
    const challengeCount = await Challenge.countDocuments({
      $or: [
        { owner: user._id },
        { 'participants.userId': user._id }
      ],
      privacy: { $ne: 'private' }
    });
    
    const rawOffset = req.headers['x-client-tz-offset'];
    const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;
    const checklistHistory = await getChecklistHistory(user._id, user.dailyChecklists, tzOffsetMin);

    const userObj = { ...user };
    userObj.challengeCount = challengeCount;
    userObj.checklistHistory = checklistHistory;
    
    res.json({
      message: 'User retrieved successfully',
      user: userObj
    });
  } catch (error) {
    console.error('Error in /users/:id endpoint:', error);
    res.status(500).json({
      message: 'Error fetching user',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Register a new user
router.post('/register', registerRateLimiter, async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;
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
    // Check duplicate email only (name can be repeated)
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
        return res.status(409).json({ message: 'A user with this email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferralCode = await generateUniqueReferralCode();

    let referredBy = null;
    const referrer = referralCode ? await resolveReferrerByCode(referralCode) : null;

    const user = new User({
      name,
      email: normalizedEmail,
      avatarUrl: req.body.avatarUrl || '',
      password: hashedPassword,
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
        userEmail: user.email,
        registeredAt: user.createdAt
      });
    } catch (emailError) {
      console.error('Failed to send registration notify email:', emailError);
    }

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
        sparks: user.sparks || 0,
        createdAt: user.createdAt,
        referredBy: user.referredBy || null
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error?.code === 11000 && error?.keyPattern?.email) {
      return res.status(409).json({ message: 'A user with this email already exists' });
    }
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
        sparks: user.sparks || 0,
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
      sparks: 1,
      createdAt: 1,
      referredBy: 1,
      _id: 1
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const referralFlags = await getReferralProfileFlags(user._id);

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        xp: user.xp || 0,
        sparks: user.sparks || 0,
        createdAt: user.createdAt,
        referredBy: referralFlags.referredBy,
        hasFirstMission: referralFlags.hasFirstMission,
        referralHookPending: referralFlags.referralHookPending,
        welcomeHookPending: referralFlags.welcomeHookPending,
        welcomeHookType: referralFlags.welcomeHookType
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching profile', error: error.message });
  }
});

router.get('/referrals/me', authenticateToken, async (req, res) => {
  try {
    const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
    const stats = await getReferralStatsForUser(req.user.id, origin);

    if (!stats) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(stats);
  } catch (error) {
    console.error('Error fetching referral stats:', error);
    res.status(500).json({ message: 'Error fetching referral stats', error: error.message });
  }
});

// Award daily 100% bonus XP (+50) once per client day
router.post('/xp/daily-bonus', authenticateToken, async (req, res) => {
  try {
    const { clientDayStr: todayStr } = getClientDayRange(req, 0);
    const xpResult = await awardDailyFullCompletionXp(req.user.id, todayStr);
    const user = xpResult.user || await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(user),
      xpResults: [xpResult],
      sparksResults: []
    });

    res.json({
      awarded: xpResult.awarded,
      date: todayStr,
      ...rewardPayload,
      xpAward: {
        gained: rewardPayload.xpGained,
        events: [{
          awarded: xpResult.awarded,
          gained: xpResult.xpGained,
          reason: xpResult.reason || null,
          eventKey: xpResult.eventKey || null
        }]
      }
    });
  } catch (error) {
    console.error('Error awarding daily bonus XP:', error);
    res.status(500).json({ message: 'Error awarding daily bonus XP', error: error.message });
  }
});

router.post('/sparks/manifest', authenticateToken, async (req, res) => {
  try {
    const { type, challengeId } = req.body;
    const manifestType = type === 'invite' ? 'invite' : 'victory';

    if (manifestType === 'invite' && !challengeId) {
      return res.status(400).json({ message: 'challengeId is required for invite manifest' });
    }

    const { clientDayStr: todayStr } = getClientDayRange(req, 0);
    const sparksResult = await awardManifestSparks(req.user.id, {
      type: manifestType,
      localDate: todayStr,
      challengeId: challengeId || null
    });
    const user = sparksResult.user || await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(user),
      xpResults: [],
      sparksResults: [sparksResult]
    });

    res.json({
      awarded: sparksResult.awarded,
      clientDay: todayStr,
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error awarding manifest sparks:', error);
    res.status(500).json({ message: 'Error awarding manifest sparks', error: error.message });
  }
});

router.post('/sparks/freeze-day', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const target = req.body?.target === 'yesterday' ? 'yesterday' : 'today';
    const dayOffset = target === 'yesterday' ? -1 : 0;
    const { clientDayStr } = getClientDayRange(req, dayOffset);
    const clientHour = getClientLocalHour(req);

    if (target === 'today') {
      if (clientHour < 22 || clientHour > 23) {
        return res.status(400).json({
          message: 'Freeze today is only available between 22:00 and 23:59',
          reason: 'freeze_window_closed'
        });
      }
    } else if (clientHour >= 10) {
      return res.status(400).json({
        message: 'Save yesterday streak is only available between 00:00 and 09:59',
        reason: 'save_yesterday_window_closed'
      });
    }

    const challenges = await Challenge.find({
      challengeType: 'habit',
      'participants.userId': userId
    });

    const eligible = [];

    for (const challenge of challenges) {
      if (isChallengeFinished(challenge)) continue;

      const participant = findChallengeParticipant(challenge, userId);
      if (!participant) continue;
      if (!isDateScheduledForChallenge(challenge, clientDayStr)) continue;
      if (isDayEffectiveCompleted(participant, clientDayStr)) continue;

      eligible.push({ challenge, participant });
    }

    const minEligible = target === 'yesterday' ? 1 : 2;

    if (eligible.length < minEligible) {
      return res.status(400).json({
        message: target === 'yesterday'
          ? 'At least one incomplete ritual from yesterday is required'
          : 'At least two incomplete rituals are required to freeze the day'
      });
    }

    const cost = SPARKS_AMOUNTS.FREEZE_DAY;
    const spendKey = buildFreezeDaySparksKey(userId, clientDayStr);
    const spendResult = await spendSparksOnce(userId, spendKey, cost, {
      clientDay: clientDayStr
    });

    if (!spendResult.success) {
      if (spendResult.reason === 'insufficient_sparks') {
        return res.status(402).json({ message: 'Insufficient sparks', reason: spendResult.reason });
      }
      if (spendResult.reason === 'already_spent') {
        return res.status(409).json({ message: 'Day already frozen', reason: spendResult.reason });
      }
      return res.status(400).json({ message: 'Unable to spend sparks', reason: spendResult.reason });
    }

    for (const { challenge, participant } of eligible) {
      appendUniqueParticipantDay(participant, 'frozenDays', clientDayStr);
      await challenge.save();
    }

    const challengeIds = eligible.map(({ challenge }) => challenge._id);
    const updatedChallenges = await Challenge.find({ _id: { $in: challengeIds } })
      .populate('owner', 'name avatarUrl')
      .populate('participants.userId', 'name avatarUrl');

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(spendResult.user)
    });

    res.json({
      message: 'Day frozen successfully',
      sparksSpent: cost,
      challenges: updatedChallenges,
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error freezing day:', error);
    res.status(500).json({ message: 'Error freezing day', error: error.message });
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
      const language = req.body.language
        || req.headers['accept-language']?.split(',')[0]?.split('-')[0];
      await sendPasswordResetEmail(user.email, resetToken, user.name, origin, language);
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

    try {
      const origin = req.headers.origin || req.headers.referer || null;
      const language = req.body.language
        || req.headers['accept-language']?.split(',')[0]?.split('-')[0];
      await sendPasswordResetSuccessEmail(user.email, user.name, origin, language);
      console.log(`Password reset success email sent to ${user.email}`);
    } catch (emailError) {
      console.error('Failed to send password reset success email:', emailError);
    }

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
      { new: true, select: 'name email avatarUrl xp sparks createdAt _id' }
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

router.get('/weekly-chronicle-settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, 'weeklyChronicleEmailEnabled preferredLanguage dailyRecapLanguage');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      weeklyChronicleEmailEnabled: !!user.weeklyChronicleEmailEnabled,
      preferredLanguage: user.preferredLanguage || user.dailyRecapLanguage || 'en'
    });
  } catch (error) {
    console.error('Error getting weekly chronicle settings:', error);
    res.status(500).json({ message: 'Error getting weekly chronicle settings', error: error.message });
  }
});

router.put('/weekly-chronicle-settings', authenticateToken, async (req, res) => {
  try {
    const { weeklyChronicleEmailEnabled, preferredLanguage, language } = req.body || {};
    const languageUpdate = preferredLanguage ?? language;

    if (weeklyChronicleEmailEnabled !== undefined && typeof weeklyChronicleEmailEnabled !== 'boolean') {
      return res.status(400).json({ message: 'weeklyChronicleEmailEnabled must be a boolean' });
    }

    if (languageUpdate !== undefined && languageUpdate !== 'ru' && languageUpdate !== 'en') {
      return res.status(400).json({ message: 'language must be "ru" or "en"' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (weeklyChronicleEmailEnabled !== undefined) {
      user.weeklyChronicleEmailEnabled = weeklyChronicleEmailEnabled;
    }

    if (languageUpdate !== undefined) {
      user.preferredLanguage = languageUpdate;
    }

    await user.save();

    res.json({
      message: 'Weekly chronicle settings updated',
      weeklyChronicleEmailEnabled: !!user.weeklyChronicleEmailEnabled,
      preferredLanguage: user.preferredLanguage || 'en'
    });
  } catch (error) {
    console.error('Error updating weekly chronicle settings:', error);
    res.status(500).json({ message: 'Error updating weekly chronicle settings', error: error.message });
  }
});

router.put('/preferred-language', authenticateToken, async (req, res) => {
  try {
    const { language, preferredLanguage } = req.body || {};
    const nextLanguage = preferredLanguage ?? language;

    if (nextLanguage !== 'ru' && nextLanguage !== 'en') {
      return res.status(400).json({ message: 'language must be "ru" or "en"' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.preferredLanguage = nextLanguage;
    await user.save();

    res.json({
      message: 'Preferred language updated',
      preferredLanguage: user.preferredLanguage
    });
  } catch (error) {
    console.error('Error updating preferred language:', error);
    res.status(500).json({ message: 'Error updating preferred language', error: error.message });
  }
});

router.post('/weekly-chronicle-settings/send-test', authenticateToken, async (req, res) => {
  try {
    const { language, preferredLanguage } = req.body || {};
    const requestLanguage = preferredLanguage ?? language;

    const user = await User.findById(req.user.id).select(
      'email name xp sparks awardedSparksEventKeys dailyRecapTimezone dailyRecapLanguage preferredLanguage'
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.email) {
      return res.status(400).json({ message: 'User email is not set' });
    }

    const report = await buildWeeklyChronicleReport(user, new Date(), {
      language: requestLanguage
    });
    await sendWeeklyChronicleEmail(user.email, report);

    res.json({
      message: 'Weekly chronicle test email sent',
      email: user.email,
      language: report.language,
      weekStart: report.weekStart,
      weekEnd: report.weekEnd
    });
  } catch (error) {
    console.error('Error sending weekly chronicle test email:', error);
    res.status(500).json({ message: 'Error sending weekly chronicle test email', error: error.message });
  }
});

router.post('/reactivation-email/send-test', authenticateToken, async (req, res) => {
  try {
    const { language, preferredLanguage } = req.body || {};
    const requestLanguage = preferredLanguage ?? language;

    const user = await User.findById(req.user.id).select(
      'email name sparks preferredLanguage dailyRecapLanguage'
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.email) {
      return res.status(400).json({ message: 'User email is not set' });
    }

    const resolvedLanguage = resolveUserReportLanguage(user, requestLanguage);
    const sparksBalance = Math.max(0, Number(user.sparks) || 0);

    await sendReactivationEmail(user.email, {
      userName: user.name,
      sparksBalance,
      language: resolvedLanguage
    });

    res.json({
      message: 'Reactivation test email sent',
      email: user.email,
      language: resolvedLanguage
    });
  } catch (error) {
    console.error('Error sending reactivation test email:', error);
    res.status(500).json({ message: 'Error sending reactivation test email', error: error.message });
  }
});

// Get today's daily checklist
router.get('/daily-checklist/today', authenticateToken, async (req, res) => {
    try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { startUtc: todayStartUtc, endUtc: todayEndUtc, clientDayStr: todayStr } = getClientDayRange(req, 0);

    const todayChecklist = await findByClientDay(
      user._id,
      todayStr,
      user.dailyChecklists,
      todayStartUtc,
      todayEndUtc
    );

    if (todayChecklist) {
      res.json({ 
        checklist: serializeChecklistForClientDay(todayChecklist, todayStr)
      });
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

    const { startUtc: todayStartUtc, endUtc: todayEndUtc, clientDayStr: todayStr } = getClientDayRange(req, 0);

    const existingTodayChecklist = await findByClientDay(
      user._id,
      todayStr,
      user.dailyChecklists,
      todayStartUtc,
      todayEndUtc
    );

    const prevTasks = existingTodayChecklist?.tasks || [];
    const xpResults = [];
    const sparksResults = [];
    const prevDoneMap = new Map(
      prevTasks.map((task, index) => [buildChecklistTaskAwardKey(task, index), Boolean(task?.done)])
    );

    for (let i = 0; i < tasks.length; i++) {
      const taskKey = buildChecklistTaskAwardKey(tasks[i], i);
      const wasDone = prevDoneMap.get(taskKey) || false;
      const isDone = Boolean(tasks[i]?.done);
      if (!wasDone && isDone) {
        xpResults.push(await awardChecklistTaskXp(user._id, todayStr, i));
        sparksResults.push(await awardChecklistTaskSparks(user._id, todayStr, taskKey));
      }
    }

    await upsertChecklist({
      userId: user._id,
      localDate: todayStr,
      timeZone: 'UTC',
      tasks,
      anchorDate: todayStartUtc
    });

    // Check for 7-day streak milestone and award XP
    const habitChallenges = await Challenge.find({
      challengeType: 'habit',
      'participants.userId': user._id
    });
    
    // Calculate current streak
    let currentStreak = 0;
    
    const streakDayKeys = [];
    for (let i = 0; i < 365; i++) {
      const { clientDayStr } = getClientDayRange(req, -i);
      streakDayKeys.push(clientDayStr);
    }
    const checklistsByLocalDate = await findManyByLocalDates(user._id, streakDayKeys);

    const checkDayCompletion = (startUtc, endUtc, dateStr) => {
      const checklistForDate = checklistsByLocalDate.get(dateStr)
        || findLatestChecklistInRange(user.dailyChecklists, startUtc, endUtc);

      const hasCompletedChecklist = hasCompletedChecklistTask(checklistForDate);

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
      
      return hasCompletedChecklist || hasCompletedChallenge;
    };
    
    // Calculate streak starting from today
    for (let i = 0; i < 365; i++) {
      const { startUtc, endUtc, clientDayStr } = getClientDayRange(req, -i);
      if (checkDayCompletion(startUtc, endUtc, clientDayStr)) {
        currentStreak++;
      } else {
        // If it's today and not completed yet, streak might still be alive if yesterday was completed
        if (i === 0) continue;
        break;
      }
    }
    
    if (currentStreak === 3) {
      sparksResults.push(await awardStreakMilestoneSparks(user._id, 3, todayStr));
    }

    if (currentStreak >= 7) {
      xpResults.push(await awardStreakMilestoneXp(user._id, 7));
    }

    if (currentStreak === 7) {
      sparksResults.push(await awardStreakMilestoneSparks(user._id, 7, todayStr));
    }

    const latestUser = await User.findById(user._id).select('name email avatarUrl xp sparks createdAt _id');
    const updatedChecklist = await findByClientDay(
      user._id,
      todayStr,
      [],
      todayStartUtc,
      todayEndUtc
    );

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(latestUser),
      xpResults,
      sparksResults
    });

    res.json({
      message: 'Checklist updated successfully',
      checklist: serializeChecklistForClientDay(updatedChecklist, todayStr),
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error updating checklist:', error);
    res.status(500).json({ message: 'Error updating checklist', error: error.message });
  }
});

// Get all daily checklists (history)
router.get('/daily-checklist/history', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('dailyChecklists');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const rawOffset = req.headers['x-client-tz-offset'];
    const tzOffsetMin = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : null;
    const grouped = await getChecklistHistory(user._id, user.dailyChecklists, tzOffsetMin);

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

    const { startUtc: tomorrowStartUtc, endUtc: tomorrowEndUtc, clientDayStr: tomorrowStr } = getClientDayRange(req, 1);

    const tomorrowChecklist = await findByClientDay(
      user._id,
      tomorrowStr,
      user.dailyChecklists,
      tomorrowStartUtc,
      tomorrowEndUtc
    );

    if (tomorrowChecklist) {
      res.json({ 
        checklist: serializeChecklistForClientDay(tomorrowChecklist, tomorrowStr)
      });
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

    const { startUtc: tomorrowStartUtc, endUtc: tomorrowEndUtc, clientDayStr: tomorrowStr } = getClientDayRange(req, 1);

    const updatedChecklist = await upsertChecklist({
      userId: user._id,
      localDate: tomorrowStr,
      timeZone: 'UTC',
      tasks,
      anchorDate: tomorrowStartUtc
    });

    res.json({
      message: 'Tomorrow\'s checklist updated successfully',
      checklist: serializeChecklistForClientDay(updatedChecklist, tomorrowStr),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        xp: user.xp || 0,
        sparks: user.sparks || 0,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error updating tomorrow\'s checklist:', error);
    res.status(500).json({ message: 'Error updating checklist', error: error.message });
  }
});

module.exports = router; 
