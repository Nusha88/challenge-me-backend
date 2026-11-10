const Challenge = require('../models/Challenge');
const {
  getClientDayRange,
  findLatestChecklistInRange
} = require('./dateHelpers');
const {
  findManyByLocalDates,
  hasCompletedChecklistTask
} = require('./dailyChecklistService');
const { getParticipantEffectiveDays } = require('./challengeHelpers');
const { awardStreakMilestoneXp } = require('./xpService');
const { awardStreakMilestoneSparks } = require('./sparksService');

function findParticipant(challenge, userId) {
  const id = String(userId);
  return (challenge.participants || []).find((participant) => {
    const participantUserId = participant.userId?._id || participant.userId || participant._id;
    return participantUserId && String(participantUserId) === id;
  });
}

function isUserActiveOnDate({
  user,
  habitChallenges,
  checklistsByLocalDate,
  startUtc,
  endUtc,
  dateStr
}) {
  const checklist = checklistsByLocalDate.get(dateStr)
    || findLatestChecklistInRange(user.dailyChecklists, startUtc, endUtc);
  if (hasCompletedChecklistTask(checklist)) return true;

  for (const challenge of habitChallenges || []) {
    const participant = findParticipant(challenge, user._id);
    if (!participant) continue;
    if (getParticipantEffectiveDays(participant).includes(dateStr)) {
      return true;
    }
  }

  return false;
}

const MAX_STREAK_SKIPS = 2;
const MAX_CONSECUTIVE_EMPTY = 2;

function resolveStreakFromDays(isFilled, { todayIsGrace = true, maxDays = 365 } = {}) {
  let days = 0;
  let totalSkipped = 0;
  let consecutiveEmpty = 0;
  let leadingEmpty = 0;
  let seenLive = false;
  let countedToday = false;

  for (let i = 0; i < maxDays; i += 1) {
    if (isFilled(i)) {
      consecutiveEmpty = 0;
      days += 1;
      seenLive = true;
      if (i === 0) countedToday = true;
      continue;
    }

    if (i === 0 && todayIsGrace) continue;

    consecutiveEmpty += 1;
    totalSkipped += 1;
    if (!seenLive) leadingEmpty = consecutiveEmpty;
    if (consecutiveEmpty > MAX_CONSECUTIVE_EMPTY || totalSkipped > MAX_STREAK_SKIPS) {
      if (!seenLive) return { days: 0, status: 'empty' };
      break;
    }
  }

  if (days === 0) return { days: 0, status: 'empty' };
  if (countedToday) return { days, status: 'live' };
  if (leadingEmpty >= 2) return { days, status: 'cooled' };
  if (leadingEmpty >= 1) return { days, status: 'paused' };
  return { days, status: 'live' };
}

async function loadHabitChallenges(userId) {
  return Challenge.find({
    challengeType: 'habit',
    'participants.userId': userId
  });
}

async function calculateUserStreak(req, user, habitChallenges) {
  const streakDayKeys = [];
  for (let i = 0; i < 365; i += 1) {
    streakDayKeys.push(getClientDayRange(req, -i).clientDayStr);
  }

  const checklistsByLocalDate = await findManyByLocalDates(user._id, streakDayKeys);
  const resolved = resolveStreakFromDays((index) => {
    const { startUtc, endUtc, clientDayStr } = getClientDayRange(req, -index);
    return isUserActiveOnDate({
      user,
      habitChallenges,
      checklistsByLocalDate,
      startUtc,
      endUtc,
      dateStr: clientDayStr
    });
  });

  return resolved.days;
}

async function awardUserStreakMilestones(req, user, habitChallenges = null) {
  if (!user?._id) {
    return { currentStreak: 0, xpResults: [], sparksResults: [] };
  }

  const challenges = habitChallenges || await loadHabitChallenges(user._id);
  const currentStreak = await calculateUserStreak(req, user, challenges);
  const todayStr = getClientDayRange(req, 0).clientDayStr;
  const xpResults = [];
  const sparksResults = [];

  if (currentStreak >= 7) {
    xpResults.push(await awardStreakMilestoneXp(user._id, 7));
  }
  if (currentStreak >= 14) {
    xpResults.push(await awardStreakMilestoneXp(user._id, 14));
  }
  if (currentStreak === 3) {
    sparksResults.push(await awardStreakMilestoneSparks(user._id, 3, todayStr));
  }
  if (currentStreak === 7) {
    sparksResults.push(await awardStreakMilestoneSparks(user._id, 7, todayStr));
  }
  if (currentStreak === 14) {
    sparksResults.push(await awardStreakMilestoneSparks(user._id, 14, todayStr));
  }

  return { currentStreak, xpResults, sparksResults };
}

module.exports = {
  isUserActiveOnDate,
  resolveStreakFromDays,
  calculateUserStreak,
  awardUserStreakMilestones
};
