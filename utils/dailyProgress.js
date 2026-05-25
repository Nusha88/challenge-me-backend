const Challenge = require('../models/Challenge');
const { toLocalDateKey, normalizeDateLikeToYmd } = require('./dateHelpers');
const { getChecklistProgress, findByUserAndLocalDate } = require('./dailyChecklistService');

/**
 * Calendar-day bounds for a mission (YYYY-MM-DD), without timezone shifting.
 * Mission dates are date-only intent from the client; converting stored Date
 * values through IANA timezones can move UTC midnight to the previous day.
 * Prefer explicit startDateKey/endDateKey when the schema adds them.
 */
function getMissionDateKeys({ startDate, endDate, startDateKey, endDateKey } = {}) {
  return {
    startKey: startDateKey || normalizeDateLikeToYmd(startDate),
    endKey: endDateKey || normalizeDateLikeToYmd(endDate)
  };
}

function isDateWithinRange(localDate, startDate, endDate) {
  const { startKey, endKey } = getMissionDateKeys({ startDate, endDate });

  if (!localDate || !startKey || !endKey) return false;

  return localDate >= startKey && localDate <= endKey;
}

function isChallengeActiveOnLocalDate(challenge, localDate) {
  if (!challenge?.startDate || !challenge?.endDate) return false;

  const { startKey, endKey } = getMissionDateKeys(challenge);

  if (!localDate || !startKey || !endKey) return false;

  return localDate >= startKey && localDate <= endKey;
}

function getMissionProgressForDate(challenges, userId, localDate) {
  let total = 0;
  let completed = 0;
  const userIdStr = String(userId);

  for (const challenge of challenges || []) {
    if (!isChallengeActiveOnLocalDate(challenge, localDate)) continue;

    const participant = (challenge.participants || []).find((participantEntry) => {
      return participantEntry?.userId && String(participantEntry.userId) === userIdStr;
    });
    if (!participant) continue;

    total += 1;

    const completedDays = Array.isArray(participant.completedDays) ? participant.completedDays : [];
    const isDoneToday = completedDays.some((day) => normalizeDateLikeToYmd(day) === localDate);
    if (isDoneToday) completed += 1;
  }

  return { total, completed };
}

function buildDailyProgress({ checklist, challenges, userId, localDate, timeZone }) {
  const checklistProgress = getChecklistProgress(checklist);
  const missionProgress = getMissionProgressForDate(challenges, userId, localDate);

  const total = checklistProgress.total + missionProgress.total;
  const completed = checklistProgress.completed + missionProgress.completed;

  return {
    userId,
    localDate,
    timeZone,
    total,
    completed,
    checklist: checklistProgress,
    mission: missionProgress,
    isEmpty: total === 0,
    isStarted: completed > 0,
    isComplete: total > 0 && completed >= total
  };
}

function groupChallengesByUserId(challenges, userIdSet) {
  const map = new Map();

  for (const challenge of challenges || []) {
    const challengeId = String(challenge._id);

    for (const participant of challenge.participants || []) {
      if (!participant?.userId) continue;

      const userIdStr = String(participant.userId);
      if (!userIdSet.has(userIdStr)) continue;

      if (!map.has(userIdStr)) {
        map.set(userIdStr, []);
      }

      const list = map.get(userIdStr);
      if (!list.some((item) => String(item._id) === challengeId)) {
        list.push(challenge);
      }
    }
  }

  return map;
}

async function loadHabitChallengesForUser(userId) {
  return Challenge.find({
    challengeType: 'habit',
    'participants.userId': userId
  }).select('startDate endDate participants');
}

async function getUserDailyProgress(user, now, options = {}) {
  const timeZone = user.dailyRecapTimezone || 'UTC';
  const localDate = toLocalDateKey(now, timeZone);
  const userId = user._id;

  const [challenges, checklist] = await Promise.all([
    options.challenges ?? loadHabitChallengesForUser(userId),
    options.checklist !== undefined
      ? Promise.resolve(options.checklist)
      : findByUserAndLocalDate(userId, localDate)
  ]);

  return buildDailyProgress({
    checklist,
    challenges,
    userId,
    localDate,
    timeZone
  });
}

module.exports = {
  getMissionDateKeys,
  isDateWithinRange,
  isChallengeActiveOnLocalDate,
  getMissionProgressForDate,
  buildDailyProgress,
  groupChallengesByUserId,
  loadHabitChallengesForUser,
  getUserDailyProgress
};
