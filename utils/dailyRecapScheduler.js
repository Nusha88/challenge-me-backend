const User = require('../models/User');
const Challenge = require('../models/Challenge');
const { findForRecapBatch } = require('./dailyChecklistService');
const { toLocalDateKey, getLocalParts } = require('./dateHelpers');
const { groupChallengesByUserId, getUserDailyProgress } = require('./dailyProgress');
const { sendDailyRecapNotification } = require('./notificationService');

const CHECK_EVERY_MS = 60 * 1000;
const RECAP_SEND_WINDOW_MINUTES = 10;

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

function isWithinSendWindow(now, targetTime, timeZone, windowMinutes = RECAP_SEND_WINDOW_MINUTES) {
  const targetMinutes = parseClockToMinutes(targetTime);
  const currentMinutes = getLocalMinutesOfDay(now, timeZone);

  if (targetMinutes === null || currentMinutes === null) return false;

  const window = Math.max(1, Number(windowMinutes) || RECAP_SEND_WINDOW_MINUTES);
  const endMinutes = targetMinutes + window;
  const minutesInDay = 24 * 60;

  if (endMinutes < minutesInDay) {
    return currentMinutes >= targetMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= targetMinutes || currentMinutes < (endMinutes % minutesInDay);
}

function isUserDueForRecapTick(user, now) {
  const tz = user.dailyRecapTimezone || 'UTC';
  const localDate = toLocalDateKey(now, tz);
  const targetTime = user.dailyRecapTime || '20:00';

  if (!isWithinSendWindow(now, targetTime, tz, RECAP_SEND_WINDOW_MINUTES)) return false;
  if (user.dailyRecapLastSentLocalDate === localDate) return false;

  return true;
}

async function processUserDailyRecap(user, now, challenges, checklistByUserAndDate) {
  const tz = user.dailyRecapTimezone || 'UTC';
  const localDate = toLocalDateKey(now, tz);

  if (user.dailyRecapLastSentLocalDate === localDate) return;

  const checklist = checklistByUserAndDate.get(`${user._id}:${localDate}`) || null;
  const progress = await getUserDailyProgress(user, now, { challenges, checklist });

  if (progress.isEmpty || progress.isComplete) return;

  await sendDailyRecapNotification(user, localDate);

  user.dailyRecapLastSentLocalDate = localDate;
  await user.save();
}

async function runDailyRecapTick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const now = new Date();

    const candidates = await User.find({
      dailyRecapEnabled: true,
      pushSubscription: { $ne: null },
      dailyRecapTime: { $exists: true, $ne: '' }
    })
      .select('_id dailyRecapTime dailyRecapTimezone dailyRecapLastSentLocalDate')
      .lean();

    const dueUserIds = candidates
      .filter((user) => isUserDueForRecapTick(user, now))
      .map((user) => user._id);

    if (dueUserIds.length === 0) return;

    const dueUsers = await User.find({ _id: { $in: dueUserIds } }).select(
      '_id pushSubscription dailyRecapTime dailyRecapTimezone dailyRecapLanguage dailyRecapLastSentLocalDate'
    );

    const dueUserIdSet = new Set(dueUsers.map((user) => String(user._id)));
    const [challenges, checklistByUserAndDate] = await Promise.all([
      Challenge.find({
        challengeType: 'habit',
        'participants.userId': { $in: dueUserIds }
      }).select('startDate endDate frequency participants'),
      findForRecapBatch(dueUsers, now)
    ]);

    const challengesByUserId = groupChallengesByUserId(challenges, dueUserIdSet);

    for (const user of dueUsers) {
      try {
        const userChallenges = challengesByUserId.get(String(user._id)) || [];
        await processUserDailyRecap(user, now, userChallenges, checklistByUserAndDate);
      } catch (error) {
        console.error('[DailyRecap] Failed user tick:', user?._id?.toString(), error?.message || error);
      }
    }
  } catch (error) {
    console.error('[DailyRecap] Tick failed:', error?.message || error);
  } finally {
    isRunning = false;
  }
}

function startDailyRecapScheduler() {
  if (intervalId) return;
  intervalId = setInterval(runDailyRecapTick, CHECK_EVERY_MS);
  setTimeout(runDailyRecapTick, 5000);
}

function stopDailyRecapScheduler() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}

module.exports = {
  startDailyRecapScheduler,
  stopDailyRecapScheduler
};
