const Challenge = require('../models/Challenge');
const { findManyByLocalDates } = require('./dailyChecklistService');
const { toLocalDateKey } = require('./dateHelpers');
const {
  getMissionProgressForDate,
  isDateWithinRange
} = require('./dailyProgress');
const {
  countCompletedActionItems,
  countTotalActionItems
} = require('./challengeHelpers');
const {
  SPARKS_AMOUNTS,
  SPARKS_EVENT_KEY_PREFIXES,
  getStreakMilestoneSparks
} = require('../constants/sparksRules');
const {
  getLevelFromXp,
  getLevelName,
  getRank,
  getXpForLevel,
  getXpForNextLevel
} = require('./levelSystem');

function addDaysToYmd(ymd, days) {
  const date = new Date(`${ymd}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildDayKeysInclusive(startKey, endKey) {
  const keys = [];
  let cursor = startKey;

  while (cursor <= endKey) {
    keys.push(cursor);
    cursor = addDaysToYmd(cursor, 1);
  }

  return keys;
}

/**
 * When sending on Sunday, returns Mon–Sun of the previous complete calendar week.
 */
function getLastCompleteWeekBounds(sundayLocalDateKey) {
  const lastSunday = addDaysToYmd(sundayLocalDateKey, -7);
  const lastMonday = addDaysToYmd(lastSunday, -6);

  return {
    start: lastMonday,
    end: lastSunday,
    weekKey: `${lastMonday}_${lastSunday}`,
    dayKeys: buildDayKeysInclusive(lastMonday, lastSunday)
  };
}

function extractLocalDateFromSparksKey(key) {
  const parts = String(key || '').split(':');

  for (const part of parts) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) {
      return part;
    }
  }

  return null;
}

function estimateSparksForKey(key) {
  const eventKey = String(key || '');

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.CHECKLIST_TASK}:`)) {
    return SPARKS_AMOUNTS.TASK_COMPLETION;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.HABIT_DAY}:`)) {
    return SPARKS_AMOUNTS.TASK_COMPLETION;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.MANIFEST}:`)) {
    return SPARKS_AMOUNTS.MANIFEST;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.STREAK_MILESTONE}:`)) {
    const milestone = parseInt(eventKey.split(':')[2], 10);
    return getStreakMilestoneSparks(milestone);
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.MISSION_COMPLETION}:`)) {
    return SPARKS_AMOUNTS.MISSION_COMPLETION;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.MISSION_EXTEND}:`)) {
    return SPARKS_AMOUNTS.MISSION_EXTEND;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.FREEZE_DAY}:`)) {
    return SPARKS_AMOUNTS.FREEZE_DAY;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.SECOND_CHANCE}:`)) {
    return SPARKS_AMOUNTS.SECOND_CHANCE;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.REFERRAL}:`)) {
    return SPARKS_AMOUNTS.REFERRAL;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.SIGNUP_BONUS}:`)) {
    return SPARKS_AMOUNTS.SIGNUP_BONUS;
  }

  if (eventKey.startsWith(`${SPARKS_EVENT_KEY_PREFIXES.MISSION_COMMENT}:`)) {
    return SPARKS_AMOUNTS.MISSION_COMMENT;
  }

  return 0;
}

function countSparksEarnedInRange(awardedSparksEventKeys, startKey, endKey) {
  let total = 0;
  let eventCount = 0;

  for (const key of awardedSparksEventKeys || []) {
    const localDate = extractLocalDateFromSparksKey(key);

    if (!localDate || localDate < startKey || localDate > endKey) {
      continue;
    }

    total += estimateSparksForKey(key);
    eventCount += 1;
  }

  return { total, eventCount };
}

function countQuestStepsFromChecklists(checklistsByDate, dayKeys, challengeIdSet) {
  let completed = 0;

  for (const dayKey of dayKeys) {
    const checklist = checklistsByDate.get(dayKey);
    if (!checklist?.tasks?.length) continue;

    for (const task of checklist.tasks) {
      if (!task?.done) continue;
      if (task?.source?.kind !== 'resultAction') continue;
      if (!challengeIdSet.has(String(task.source.challengeId))) continue;

      completed += 1;
    }
  }

  return completed;
}

function buildRitualSummary(habitChallenges, userId, dayKeys) {
  let scheduledTotal = 0;
  let completedTotal = 0;
  const daily = [];

  for (const dayKey of dayKeys) {
    const progress = getMissionProgressForDate(habitChallenges, userId, dayKey);
    scheduledTotal += progress.total;
    completedTotal += progress.completed;

    if (progress.total > 0) {
      daily.push({
        date: dayKey,
        completed: progress.completed,
        total: progress.total
      });
    }
  }

  return {
    scheduledTotal,
    completedTotal,
    completionRate: scheduledTotal > 0
      ? Math.round((completedTotal / scheduledTotal) * 100)
      : null,
    daily
  };
}

function buildQuestSummaries(resultChallenges, userId, dayKeys, checklistsByDate) {
  const userIdStr = String(userId);
  const summaries = [];

  for (const challenge of resultChallenges || []) {
    const isOwner = challenge.owner && String(challenge.owner) === userIdStr;
    const isParticipant = (challenge.participants || []).some(
      (participant) => participant?.userId && String(participant.userId) === userIdStr
    );

    if (!isOwner && !isParticipant) continue;

    const weekActive = dayKeys.some((dayKey) => isDateWithinRange(
      dayKey,
      challenge.startDate,
      challenge.endDate
    ));

    if (!weekActive) continue;

    const challengeIdSet = new Set([String(challenge._id)]);
    const stepsCompletedThisWeek = countQuestStepsFromChecklists(
      checklistsByDate,
      dayKeys,
      challengeIdSet
    );

    const totalSteps = countTotalActionItems(challenge.actions);
    const overallCompleted = countCompletedActionItems(challenge.actions);

    summaries.push({
      id: String(challenge._id),
      title: challenge.title || '',
      stepsCompletedThisWeek,
      overallCompleted,
      totalSteps,
      isComplete: totalSteps > 0 && overallCompleted >= totalSteps
    });
  }

  return summaries.sort((a, b) => b.stepsCompletedThisWeek - a.stepsCompletedThisWeek);
}

function resolveUserReportLanguage(user, overrideLanguage = null) {
  if (overrideLanguage === 'ru' || overrideLanguage === 'en') {
    return overrideLanguage;
  }

  if (user?.preferredLanguage === 'ru' || user?.preferredLanguage === 'en') {
    return user.preferredLanguage;
  }

  if (user?.dailyRecapLanguage === 'ru') {
    return 'ru';
  }

  return 'en';
}

async function buildWeeklyChronicleReport(user, now = new Date(), options = {}) {
  const timeZone = user.dailyRecapTimezone || 'UTC';
  const language = resolveUserReportLanguage(user, options.language);
  const todayKey = toLocalDateKey(now, timeZone);
  const weekBounds = getLastCompleteWeekBounds(todayKey);
  const userId = user._id;

  const [habitChallenges, resultChallenges, checklistsByDate] = await Promise.all([
    Challenge.find({
      challengeType: 'habit',
      'participants.userId': userId
    }).select('startDate endDate frequency participants title').lean(),
    Challenge.find({
      challengeType: 'result',
      $or: [
        { owner: userId },
        { 'participants.userId': userId }
      ]
    }).select('title startDate endDate actions owner participants').lean(),
    findManyByLocalDates(userId, weekBounds.dayKeys)
  ]);

  const rituals = buildRitualSummary(habitChallenges, userId, weekBounds.dayKeys);
  const quests = buildQuestSummaries(resultChallenges, userId, weekBounds.dayKeys, checklistsByDate);
  const sparksWeek = countSparksEarnedInRange(
    user.awardedSparksEventKeys,
    weekBounds.start,
    weekBounds.end
  );

  const level = getLevelFromXp(user.xp);
  const rankRoman = getRank(level);
  const rankName = getLevelName(level, language);
  const xp = Math.max(0, Number(user.xp) || 0);
  const xpLevelStart = getXpForLevel(level);
  const xpNextThreshold = getXpForNextLevel(level);
  const xpInCurrentLevel = Math.max(0, xp - xpLevelStart);
  const xpNeededForLevel = Math.max(1, xpNextThreshold - xpLevelStart);
  const levelProgressPercent = Math.min(
    100,
    Math.round((xpInCurrentLevel / xpNeededForLevel) * 100)
  );

  const dailyByDate = new Map((rituals.daily || []).map((day) => [day.date, day]));
  const weekDays = weekBounds.dayKeys.map((date) => {
    const day = dailyByDate.get(date);
    const completed = day?.completed ?? 0;
    const total = day?.total ?? 0;

    return {
      date,
      completed,
      total,
      hasActivity: total > 0,
      isFullyComplete: total > 0 && completed >= total
    };
  });

  return {
    userId: String(userId),
    userName: user.name || 'Hero',
    language,
    timeZone,
    weekKey: weekBounds.weekKey,
    weekStart: weekBounds.start,
    weekEnd: weekBounds.end,
    rituals: {
      ...rituals,
      weekDays
    },
    quests,
    sparks: {
      earnedThisWeek: sparksWeek.total,
      eventsThisWeek: sparksWeek.eventCount,
      currentBalance: Math.max(0, Number(user.sparks) || 0)
    },
    rank: {
      level,
      rankRoman,
      rankName,
      xp,
      xpInCurrentLevel,
      xpNeededForLevel,
      levelProgressPercent
    },
    isEmpty: rituals.scheduledTotal === 0
      && quests.length === 0
      && sparksWeek.total === 0
  };
}

module.exports = {
  addDaysToYmd,
  getLastCompleteWeekBounds,
  resolveUserReportLanguage,
  buildWeeklyChronicleReport
};
