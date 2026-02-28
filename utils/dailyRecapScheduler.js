const User = require('../models/User');
const Challenge = require('../models/Challenge');
const { sendPushNotification } = require('./pushService');

const CHECK_EVERY_MS = 60 * 1000;

let intervalId = null;
let isRunning = false;

function getLocalParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute')
    };
  } catch {
    return getLocalParts(date, 'UTC');
  }
}

function toLocalDateKey(date, timeZone) {
  const p = getLocalParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function toLocalTimeKey(date, timeZone) {
  const p = getLocalParts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

function normalizeDateLikeToYmd(value) {
  if (!value) return null;
  const raw = String(value);
  if (raw.length >= 10) {
    const candidate = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return candidate;
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getLocalizedRecap(userLanguage) {
  const language = userLanguage === 'ru' ? 'ru' : 'en';

  if (language === 'ru') {
    return {
      title: 'Итоги дня',
      bodies: [
        'Миссии дня еще активны. Сделаем финальный рывок?',
        'До завершения сегодняшнего плана осталось совсем немного.'
      ]
    };
  }

  return {
    title: 'Daily Recap',
    bodies: [
      "Today's missions are still active. Shall we make a final push?",
      "Only a little remains to complete today's plan."
    ]
  };
}

function isDateWithinRange(localDate, startDate, endDate, timeZone) {
  const startKey = toLocalDateKey(new Date(startDate), timeZone);
  const endKey = toLocalDateKey(new Date(endDate), timeZone);
  return localDate >= startKey && localDate <= endKey;
}

function getChecklistProgressForDate(user, localDate, timeZone) {
  const list = Array.isArray(user.dailyChecklists) ? user.dailyChecklists : [];
  const todayEntries = list.filter((entry) => {
    if (!entry?.date) return false;
    return toLocalDateKey(new Date(entry.date), timeZone) === localDate;
  });

  let total = 0;
  let completed = 0;

  for (const entry of todayEntries) {
    const tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
    total += tasks.length;
    completed += tasks.filter((task) => !!task?.done).length;
  }

  return { total, completed };
}

function getMissionProgressForDate(challenges, userId, localDate, timeZone) {
  let total = 0;
  let completed = 0;
  const userIdStr = String(userId);

  for (const challenge of challenges) {
    if (!challenge?.startDate || !challenge?.endDate) continue;
    if (!isDateWithinRange(localDate, challenge.startDate, challenge.endDate, timeZone)) continue;

    const participant = (challenge.participants || []).find((p) => {
      return p?.userId && String(p.userId) === userIdStr;
    });
    if (!participant) continue;

    total += 1;
    const completedDays = Array.isArray(participant.completedDays) ? participant.completedDays : [];
    const isDoneToday = completedDays.some((d) => normalizeDateLikeToYmd(d) === localDate);
    if (isDoneToday) completed += 1;
  }

  return { total, completed };
}

async function processUserDailyRecap(user, now) {
  const tz = user.dailyRecapTimezone || 'UTC';
  const localTime = toLocalTimeKey(now, tz);
  const localDate = toLocalDateKey(now, tz);
  const targetTime = user.dailyRecapTime || '20:00';

  if (localTime !== targetTime) return;
  if (user.dailyRecapLastSentLocalDate === localDate) return;

  const challenges = await Challenge.find({
    challengeType: 'habit',
    'participants.userId': user._id
  }).select('startDate endDate participants');

  const checklistProgress = getChecklistProgressForDate(user, localDate, tz);
  const missionProgress = getMissionProgressForDate(challenges, user._id, localDate, tz);

  const totalItems = checklistProgress.total + missionProgress.total;
  const completedItems = checklistProgress.completed + missionProgress.completed;

  if (totalItems === 0) return;
  if (completedItems <= 0 || completedItems >= totalItems) return;

  const localized = getLocalizedRecap(user.dailyRecapLanguage);
  const body = localized.bodies[Math.floor(Math.random() * localized.bodies.length)];

  await sendPushNotification(user._id, {
    title: localized.title,
    body,
    tag: 'daily-recap',
    data: { type: 'daily-recap' }
  });

  user.dailyRecapLastSentLocalDate = localDate;
  await user.save();
}

async function runDailyRecapTick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const now = new Date();
    const users = await User.find({
      dailyRecapEnabled: true,
      pushSubscription: { $ne: null },
      dailyRecapTime: { $exists: true, $ne: '' }
    }).select(
      '_id pushSubscription dailyRecapEnabled dailyRecapTime dailyRecapTimezone dailyRecapLanguage dailyRecapLastSentLocalDate dailyChecklists'
    );

    for (const user of users) {
      try {
        await processUserDailyRecap(user, now);
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

