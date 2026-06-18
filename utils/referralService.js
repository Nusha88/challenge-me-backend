const crypto = require('crypto');
const User = require('../models/User');
const Referral = require('../models/Referral');
const Challenge = require('../models/Challenge');
const { awardSparksOnce } = require('./sparksService');
const { SPARKS_AMOUNTS, buildReferralSparksKey, buildSignupBonusSparksKey } = require('../constants/sparksRules');
const { buildRewardPayload } = require('./rewardResponse');
const { notifyReferralCompleted } = require('./notificationService');

const MAX_COMPLETED_REFERRALS = 5;
const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
    let code = '';

    for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
      code += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
    }

    const existing = await User.findOne({ referralCode: code }).select('_id').lean();
    if (!existing) {
      return code;
    }
  }

  throw new Error('Unable to generate unique referral code');
}

async function ensureUserReferralCode(user) {
  if (user.referralCode) {
    return user.referralCode;
  }

  const code = await generateUniqueReferralCode();
  user.referralCode = code;
  await user.save();
  return code;
}

async function countCompletedReferrals(referrerId) {
  return Referral.countDocuments({
    referrerId,
    status: 'completed'
  });
}

async function resolveReferrerByCode(code) {
  if (!code || typeof code !== 'string') return null;

  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return null;

  const referrer = await User.findOne({ referralCode: normalizedCode }).select('_id referralCode');
  if (!referrer) return null;

  const completedCount = await countCompletedReferrals(referrer._id);
  if (completedCount >= MAX_COMPLETED_REFERRALS) {
    return null;
  }

  return referrer;
}

async function createPendingReferral(referrerId, refereeId) {
  if (!referrerId || !refereeId) return null;
  if (referrerId.toString() === refereeId.toString()) return null;

  const existing = await Referral.findOne({ refereeId });
  if (existing) return existing;

  const completedCount = await countCompletedReferrals(referrerId);
  if (completedCount >= MAX_COMPLETED_REFERRALS) {
    return null;
  }

  return Referral.create({
    referrerId,
    refereeId,
    status: 'pending'
  });
}

async function countUserMissions(userId) {
  if (!userId) return 0;

  return Challenge.countDocuments({
    $or: [
      { owner: userId },
      { 'participants.userId': userId }
    ]
  });
}

function buildReferralLink(referralCode, origin) {
  const base = (origin || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/register?ref=${encodeURIComponent(referralCode)}`;
}

async function getReferralStatsForUser(userId, origin) {
  const user = await User.findById(userId).select('referralCode');
  if (!user) {
    return null;
  }

  const referralCode = await ensureUserReferralCode(user);
  const invitedCount = await countCompletedReferrals(userId);

  return {
    referralCode,
    referralLink: buildReferralLink(referralCode, origin),
    invitedCount,
    maxInvites: MAX_COMPLETED_REFERRALS,
    canInviteMore: invitedCount < MAX_COMPLETED_REFERRALS,
    showReferralUi: invitedCount < MAX_COMPLETED_REFERRALS
  };
}

async function getReferralProfileFlags(userId) {
  const user = await User.findById(userId).select('referredBy');
  if (!user) {
    return {
      referredBy: null,
      hasFirstMission: false,
      referralHookPending: false,
      welcomeHookPending: false,
      welcomeHookType: null
    };
  }

  const missionCount = await countUserMissions(userId);
  const hasFirstMission = missionCount > 0;
  const welcomeHookPending = !hasFirstMission;
  const welcomeHookType = welcomeHookPending
    ? (user.referredBy ? 'referral' : 'signup')
    : null;

  return {
    referredBy: user.referredBy || null,
    hasFirstMission,
    referralHookPending: Boolean(user.referredBy) && !hasFirstMission,
    welcomeHookPending,
    welcomeHookType
  };
}

async function tryCompleteReferral(refereeId) {
  const missionCount = await countUserMissions(refereeId);
  if (missionCount !== 1) {
    return { completed: false, reason: 'not_first_mission' };
  }

  const referral = await Referral.findOne({
    refereeId,
    status: 'pending'
  });

  if (!referral) {
    return { completed: false, reason: 'no_pending_referral' };
  }

  const referrerId = referral.referrerId;
  const amount = SPARKS_AMOUNTS.REFERRAL;
  const referrerKey = buildReferralSparksKey('referrer', referrerId, refereeId);
  const refereeKey = buildReferralSparksKey('referee', referrerId, refereeId);

  const [referrerAward, refereeAward] = await Promise.all([
    awardSparksOnce(referrerId, referrerKey, amount),
    awardSparksOnce(refereeId, refereeKey, amount)
  ]);

  referral.status = 'completed';
  referral.completedAt = new Date();
  await referral.save();

  const referee = await User.findById(refereeId).select('name');
  await notifyReferralCompleted({
    referrerId,
    refereeId,
    refereeName: referee?.name || 'Friend'
  });

  return {
    completed: true,
    referrerAward,
    refereeAward,
    referral
  };
}

async function tryCompleteSignupBonus(userId) {
  const missionCount = await countUserMissions(userId);
  if (missionCount !== 1) {
    return { completed: false, reason: 'not_first_mission' };
  }

  const user = await User.findById(userId).select('referredBy');
  if (!user || user.referredBy) {
    return { completed: false, reason: 'referred_user' };
  }

  const amount = SPARKS_AMOUNTS.SIGNUP_BONUS;
  const key = buildSignupBonusSparksKey(userId);
  const award = await awardSparksOnce(userId, key, amount);

  return {
    completed: Boolean(award?.awarded),
    award
  };
}

async function applyWelcomeBonusesForUser(userId) {
  const sparksResults = [];

  const referralResult = await tryCompleteReferral(userId);
  if (referralResult?.refereeAward?.awarded) {
    sparksResults.push(referralResult.refereeAward);
  }

  const signupResult = await tryCompleteSignupBonus(userId);
  if (signupResult?.award?.awarded) {
    sparksResults.push(signupResult.award);
  }

  return sparksResults;
}

async function getWelcomeBonusRewardPayload(userId, serializeUser) {
  let sparksResults = [];

  try {
    sparksResults = await applyWelcomeBonusesForUser(userId);
  } catch (error) {
    console.error('Error applying welcome bonuses:', error);
    return {};
  }

  if (!sparksResults.length) {
    return {};
  }

  const user = await User.findById(userId).select('name email avatarUrl xp sparks createdAt _id');
  if (!user) {
    return {};
  }

  return buildRewardPayload({
    user: serializeUser(user),
    sparksResults
  });
}

module.exports = {
  MAX_COMPLETED_REFERRALS,
  generateUniqueReferralCode,
  ensureUserReferralCode,
  countCompletedReferrals,
  resolveReferrerByCode,
  createPendingReferral,
  countUserMissions,
  buildReferralLink,
  getReferralStatsForUser,
  getReferralProfileFlags,
  tryCompleteReferral,
  tryCompleteSignupBonus,
  applyWelcomeBonusesForUser,
  getWelcomeBonusRewardPayload
};
