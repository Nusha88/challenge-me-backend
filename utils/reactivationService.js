const User = require('../models/User');
const Challenge = require('../models/Challenge');
const { toLocalDateKey } = require('./dateHelpers');
const { getMissionProgressForDate } = require('./dailyProgress');
const { addDaysToYmd } = require('./weeklyChronicleReport');
const { resolveUserReportLanguage } = require('./weeklyChronicleReport');
const { getFirstName } = require('./reactivationEmailMessages');
const { sendReactivationEmail } = require('./emailService');

const MISSED_DAYS_REQUIRED = 3;
/** After this many consecutive missed days, stop sending reactivation emails. */
const MAX_INACTIVE_DAYS_FOR_EMAIL = 6;

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
 * Returns a stable streak key for the current inactivity pause when the user
 * missed all scheduled habits for 3–6 consecutive calendar days ending
 * yesterday (in their timezone). After a full week of no progress, returns null.
 *
 * The key is based on the first 3 missed days of the pause so it does not slide
 * day-to-day (which would re-trigger the email every day).
 */
function detectInactiveHabitStreak(challenges, userId, todayLocalKey) {
  const missedNewestFirst = [];

  for (let offset = 1; offset <= MAX_INACTIVE_DAYS_FOR_EMAIL + 1; offset += 1) {
    const dayKey = addDaysToYmd(todayLocalKey, -offset);
    const progress = getMissionProgressForDate(challenges, userId, dayKey);

    if (progress.total <= 0 || progress.completed > 0) {
      break;
    }

    missedNewestFirst.push(dayKey);
  }

  const missedCount = missedNewestFirst.length;

  if (missedCount < MISSED_DAYS_REQUIRED) {
    return null;
  }

  // A full week (7+) of no progress — do not send reactivation emails anymore.
  if (missedCount > MAX_INACTIVE_DAYS_FOR_EMAIL) {
    return null;
  }

  const chronological = [...missedNewestFirst].reverse();
  return buildInactiveStreakKey(chronological.slice(0, MISSED_DAYS_REQUIRED));
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
  if (user.reactivationEmailEnabled === false) return false;
  // One email per pause — any prior send blocks until the user logs progress again.
  if (user.reactivationEmailSentStreakKey) return false;

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
    userId: user._id,
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
  MAX_INACTIVE_DAYS_FOR_EMAIL,
  getUserTimezone,
  detectInactiveHabitStreak,
  loadHabitChallengesForUsers,
  shouldSendReactivationEmail,
  clearReactivationStreakFlag,
  processUserReactivation
};
