const User = require('../models/User');
const { toLocalDateKey, getLocalParts } = require('./dateHelpers');
const { getLastCompleteWeekBounds, buildWeeklyChronicleReport } = require('./weeklyChronicleReport');
const { sendWeeklyChronicleEmail } = require('./emailService');

const CHECK_EVERY_MS = 60 * 1000;
const SEND_WINDOW_MINUTES = 15;
const DEFAULT_SEND_TIME = process.env.WEEKLY_CHRONICLE_SEND_TIME || '10:00';
const DEFAULT_SEND_WEEKDAY = Number(process.env.WEEKLY_CHRONICLE_SEND_WEEKDAY ?? 0);

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

function getLocalWeekdayIndex(now, timeZone) {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'long'
    }).format(now);

    const map = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6
    };

    return map[weekday] ?? null;
  } catch {
    return now.getUTCDay();
  }
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

function isUserDueForWeeklyChronicle(user, now) {
  const tz = user.dailyRecapTimezone || 'UTC';
  const todayKey = toLocalDateKey(now, tz);
  const weekday = getLocalWeekdayIndex(now, tz);
  const targetWeekday = Number.isFinite(DEFAULT_SEND_WEEKDAY) ? DEFAULT_SEND_WEEKDAY : 0;

  if (weekday !== targetWeekday) return false;
  if (!isWithinSendWindow(now, DEFAULT_SEND_TIME, tz, SEND_WINDOW_MINUTES)) return false;

  const { weekKey } = getLastCompleteWeekBounds(todayKey);
  if (user.weeklyChronicleLastSentWeekKey === weekKey) return false;

  return true;
}

async function processUserWeeklyChronicle(user, now) {
  const tz = user.dailyRecapTimezone || 'UTC';
  const todayKey = toLocalDateKey(now, tz);
  const { weekKey } = getLastCompleteWeekBounds(todayKey);

  if (user.weeklyChronicleLastSentWeekKey === weekKey) return;

  const report = await buildWeeklyChronicleReport(user, now);
  await sendWeeklyChronicleEmail(user.email, report);

  user.weeklyChronicleLastSentWeekKey = weekKey;
  await user.save();
}

async function runWeeklyChronicleTick() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    const candidates = await User.find({
      weeklyChronicleEmailEnabled: true,
      email: { $exists: true, $ne: '' }
    })
      .select('_id email name xp sparks awardedSparksEventKeys dailyRecapTimezone dailyRecapLanguage preferredLanguage weeklyChronicleLastSentWeekKey')
      .lean();

    const dueUserIds = candidates
      .filter((user) => isUserDueForWeeklyChronicle(user, now))
      .map((user) => user._id);

    if (dueUserIds.length === 0) return;

    const dueUsers = await User.find({ _id: { $in: dueUserIds } }).select(
      '_id email name xp sparks awardedSparksEventKeys dailyRecapTimezone dailyRecapLanguage preferredLanguage weeklyChronicleLastSentWeekKey'
    );

    for (const user of dueUsers) {
      try {
        await processUserWeeklyChronicle(user, now);
      } catch (error) {
        console.error('[WeeklyChronicle] Failed user tick:', user?._id?.toString(), error?.message || error);
      }
    }
  } catch (error) {
    console.error('[WeeklyChronicle] Tick failed:', error?.message || error);
  } finally {
    isRunning = false;
  }
}

function startWeeklyChronicleScheduler() {
  if (intervalId) return;
  intervalId = setInterval(runWeeklyChronicleTick, CHECK_EVERY_MS);
  setTimeout(runWeeklyChronicleTick, 8000);
}

function stopWeeklyChronicleScheduler() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}

module.exports = {
  startWeeklyChronicleScheduler,
  stopWeeklyChronicleScheduler,
  isUserDueForWeeklyChronicle
};
