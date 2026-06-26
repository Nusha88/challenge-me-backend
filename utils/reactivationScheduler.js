const User = require('../models/User');
const Challenge = require('../models/Challenge');
const { toLocalDateKey, getLocalParts } = require('./dateHelpers');
const {
  loadHabitChallengesForUsers,
  processUserReactivation
} = require('./reactivationService');

const CHECK_EVERY_MS = 60 * 60 * 1000;
const SEND_WINDOW_MINUTES = 30;
const DEFAULT_SEND_TIME = process.env.REACTIVATION_EMAIL_SEND_TIME || '11:00';
const REACTIVATION_EMAIL_ENABLED = process.env.REACTIVATION_EMAIL_ENABLED !== 'false';

let intervalId = null;
let isRunning = false;

function parseClockToMinutes(timeStr) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function getLocalMinutesOfDay(now, timeZone) {
  const parts = getLocalParts(now, timeZone);
  const hours = parseInt(parts.hour, 10);
  const minutes = parseInt(parts.minute, 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  return hours * 60 + minutes;
}

function isWithinSendWindow(now, targetTime, timeZone, windowMinutes = SEND_WINDOW_MINUTES) {
  const targetMinutes = parseClockToMinutes(targetTime);
  const currentMinutes = getLocalMinutesOfDay(now, timeZone);

  if (targetMinutes === null || currentMinutes === null) return false;

  const window = Math.max(1, Number(windowMinutes) || SEND_WINDOW_MINUTES);
  const endMinutes = targetMinutes + window;
  const minutesInDay = 24 * 60;

  if (endMinutes < minutesInDay) {
    return currentMinutes >= targetMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= targetMinutes || currentMinutes < (endMinutes % minutesInDay);
}

function isUserDueForReactivationTick(user, now) {
  const tz = user.dailyRecapTimezone || 'UTC';

  if (!isWithinSendWindow(now, DEFAULT_SEND_TIME, tz, SEND_WINDOW_MINUTES)) {
    return false;
  }

  const localDate = toLocalDateKey(now, tz);
  if (user.reactivationEmailLastCheckedLocalDate === localDate) {
    return false;
  }

  return true;
}

async function runReactivationTick() {
  if (!REACTIVATION_EMAIL_ENABLED || isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    const habitUserIds = await Challenge.distinct('participants.userId', {
      challengeType: 'habit'
    });

    if (habitUserIds.length === 0) return;

    const candidates = await User.find({
      _id: { $in: habitUserIds },
      email: { $exists: true, $ne: '' }
    })
      .select('_id name email sparks dailyRecapTimezone preferredLanguage dailyRecapLanguage reactivationEmailSentStreakKey reactivationEmailLastCheckedLocalDate')
      .lean();

    const dueUsers = candidates.filter((user) => isUserDueForReactivationTick(user, now));

    if (dueUsers.length === 0) return;

    const dueUserIds = dueUsers.map((user) => user._id);
    const challengesByUserId = await loadHabitChallengesForUsers(dueUserIds);
    const dueUserDocs = await User.find({ _id: { $in: dueUserIds } }).select(
      '_id name email sparks dailyRecapTimezone preferredLanguage dailyRecapLanguage reactivationEmailSentStreakKey reactivationEmailLastCheckedLocalDate'
    );

    for (const user of dueUserDocs) {
      const tz = user.dailyRecapTimezone || 'UTC';
      const localDate = toLocalDateKey(now, tz);

      try {
        const habitChallenges = challengesByUserId.get(String(user._id)) || [];
        await processUserReactivation(user, now, habitChallenges);
      } catch (error) {
        console.error('[ReactivationEmail] Failed user tick:', user?._id?.toString(), error?.message || error);
      } finally {
        user.reactivationEmailLastCheckedLocalDate = localDate;
        await user.save();
      }
    }
  } catch (error) {
    console.error('[ReactivationEmail] Tick failed:', error?.message || error);
  } finally {
    isRunning = false;
  }
}

function startReactivationScheduler() {
  if (intervalId || !REACTIVATION_EMAIL_ENABLED) return;
  intervalId = setInterval(runReactivationTick, CHECK_EVERY_MS);
  setTimeout(runReactivationTick, 15000);
}

function stopReactivationScheduler() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}

module.exports = {
  startReactivationScheduler,
  stopReactivationScheduler,
  runReactivationTick
};
