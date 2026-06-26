const User = require('../models/User');
const Challenge = require('../models/Challenge');
const { toLocalDateKey } = require('./dateHelpers');
const { getMissionProgressForDate } = require('./dailyProgress');
const { addDaysToYmd } = require('./weeklyChronicleReport');
const { resolveUserReportLanguage } = require('./weeklyChronicleReport');
const { getFirstName } = require('./reactivationEmailMessages');
const { sendReactivationEmail } = require('./emailService');

const MISSED_DAYS_REQUIRED = 3;

function getUserTimezone(user) {
  return user?.dailyRecapTimezone || 'UTC';
}

function buildInactiveStreakKey(dayKeys) {
  if (!Array.isArray(dayKeys) || dayKeys.length !== MISSED_DAYS_REQUIRED) {
    return null;
  }

  return dayKeys.join('_');
}

/**
 * Returns streak key when the user missed all scheduled habits on each of the
 * last 3 consecutive calendar days ending yesterday (in their timezone).
 */
function detectInactiveHabitStreak(challenges, userId, todayLocalKey) {
  const dayKeys = [];

  for (let offset = MISSED_DAYS_REQUIRED; offset >= 1; offset -= 1) {
    dayKeys.push(addDaysToYmd(todayLocalKey, -offset));
  }

  for (const dayKey of dayKeys) {
    const progress = getMissionProgressForDate(challenges, userId, dayKey);

    if (progress.total <= 0) {
      return null;
    }

    if (progress.completed > 0) {
      return null;
    }
  }

  return buildInactiveStreakKey(dayKeys);
}

async function loadHabitChallengesForUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const challenges = await Challenge.find({
    challengeType: 'habit',
    'participants.userId': { $in: userIds }
  }).select('startDate endDate frequency participants');

  const map = new Map();

  for (const challenge of challenges) {
    for (const participant of challenge.participants || []) {
      if (!participant?.userId) continue;

      const userIdStr = String(participant.userId);
      if (!userIds.some((id) => String(id) === userIdStr)) continue;

      if (!map.has(userIdStr)) {
        map.set(userIdStr, []);
      }

      map.get(userIdStr).push(challenge);
    }
  }

  return map;
}

function shouldSendReactivationEmail(user, streakKey) {
  if (!streakKey) return false;
  if (!user?.email) return false;
  if (user.reactivationEmailSentStreakKey === streakKey) return false;

  return true;
}

async function clearReactivationStreakFlag(userId) {
  if (!userId) return;

  await User.findByIdAndUpdate(userId, {
    $set: { reactivationEmailSentStreakKey: null }
  });
}

async function processUserReactivation(user, now, habitChallenges) {
  const tz = getUserTimezone(user);
  const todayKey = toLocalDateKey(now, tz);
  const streakKey = detectInactiveHabitStreak(habitChallenges, user._id, todayKey);

  if (!shouldSendReactivationEmail(user, streakKey)) {
    return { sent: false, streakKey };
  }

  const language = resolveUserReportLanguage(user);
  const sparksBalance = Math.max(0, Number(user.sparks) || 0);

  await sendReactivationEmail(user.email, {
    userName: user.name,
    firstName: getFirstName(user.name),
    sparksBalance,
    language
  });

  user.reactivationEmailSentStreakKey = streakKey;
  user.reactivationEmailSentAt = now;
  await user.save();

  return { sent: true, streakKey, language };
}

module.exports = {
  MISSED_DAYS_REQUIRED,
  getUserTimezone,
  detectInactiveHabitStreak,
  loadHabitChallengesForUsers,
  shouldSendReactivationEmail,
  clearReactivationStreakFlag,
  processUserReactivation
};
