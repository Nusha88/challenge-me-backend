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
  let currentStreak = 0;

  for (let i = 0; i < 365; i += 1) {
    const { startUtc, endUtc, clientDayStr } = getClientDayRange(req, -i);
    if (isUserActiveOnDate({
      user,
      habitChallenges,
      checklistsByLocalDate,
      startUtc,
      endUtc,
      dateStr: clientDayStr
    })) {
      currentStreak += 1;
    } else if (i === 0) {
      continue;
    } else {
      break;
    }
  }

  return currentStreak;
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
  calculateUserStreak,
  awardUserStreakMilestones
};
