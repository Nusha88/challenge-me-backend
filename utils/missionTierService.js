const { XP_AMOUNTS } = require('../constants/xpRules');
const { SPARKS_AMOUNTS } = require('../constants/sparksRules');
const {
  countScheduledMissionDays,
  getParticipantEffectiveDays,
  isDateScheduledForChallenge
} = require('./challengeHelpers');
const { normalizeDateLikeToYmd } = require('./dateHelpers');

const MISSION_TIERS = Object.freeze({
  PERFECT: 'perfect',
  BRIGHT: 'bright',
  SUSTAINED: 'sustained',
  EXTINGUISHED: 'extinguished'
});

function getParticipantJoinedAtKey(challenge, participant) {
  const joined = participant?.joinedAt || challenge?.startDate;
  return normalizeDateLikeToYmd(joined);
}

function getPersonalTrackingEndKey(challenge) {
  return normalizeDateLikeToYmd(challenge.endDate);
}

function countPersonalScheduledDays(challenge, participant) {
  const startKey = getParticipantJoinedAtKey(challenge, participant);
  const endKey = getPersonalTrackingEndKey(challenge);
  if (!startKey || !endKey || endKey < startKey) return 0;

  return countScheduledMissionDays(startKey, endKey, challenge.frequency);
}

function countPersonalEffectiveDays(challenge, participant) {
  const startKey = getParticipantJoinedAtKey(challenge, participant);
  const endKey = getPersonalTrackingEndKey(challenge);
  const personalChallenge = { ...challenge.toObject?.() || challenge, startDate: startKey };

  return getParticipantEffectiveDays(participant).filter((dayKey) => {
    if (dayKey < startKey || dayKey > endKey) return false;
    return isDateScheduledForChallenge(personalChallenge, dayKey);
  }).length;
}

function calculateCompletionRate(challenge, participant) {
  const total = countPersonalScheduledDays(challenge, participant);
  if (total <= 0) return 0;
  const done = countPersonalEffectiveDays(challenge, participant);
  return Math.round((done / total) * 1000) / 10;
}

function resolveMissionTier(completionRate) {
  if (completionRate >= 100) return MISSION_TIERS.PERFECT;
  if (completionRate >= 85) return MISSION_TIERS.BRIGHT;
  if (completionRate >= 70) return MISSION_TIERS.SUSTAINED;
  return MISSION_TIERS.EXTINGUISHED;
}

function getTierRewards(tier) {
  switch (tier) {
    case MISSION_TIERS.PERFECT:
      return {
        xp: XP_AMOUNTS.HABIT_COMPLETION,
        sparks: SPARKS_AMOUNTS.MISSION_COMPLETION,
        badge: 'perfect_flame'
      };
    case MISSION_TIERS.BRIGHT:
      return {
        xp: XP_AMOUNTS.HABIT_COMPLETION,
        sparks: SPARKS_AMOUNTS.MISSION_COMPLETION,
        badge: null
      };
    case MISSION_TIERS.SUSTAINED:
      return {
        xp: Math.round(XP_AMOUNTS.HABIT_COMPLETION * 0.5),
        sparks: Math.round(SPARKS_AMOUNTS.MISSION_COMPLETION * 0.53),
        badge: null
      };
    default:
      return { xp: 0, sparks: 0, badge: null };
  }
}

function getStandardMissionDuration(challenge) {
  return countScheduledMissionDays(
    challenge.startDate,
    challenge.endDate,
    challenge.frequency
  );
}

function isLateJoiner(challenge, participant) {
  const joinedKey = getParticipantJoinedAtKey(challenge, participant);
  const startKey = normalizeDateLikeToYmd(challenge.startDate);
  if (!joinedKey || !startKey) return false;
  return joinedKey > startKey;
}

function needsSoloContinuation(challenge, participant) {
  if (!isLateJoiner(challenge, participant)) return false;
  const personalTotal = countPersonalScheduledDays(challenge, participant);
  const standardDuration = getStandardMissionDuration(challenge);
  return personalTotal < standardDuration;
}

function getSoloContinuationDates(challenge, participant, customEndDate = null) {
  const joinedKey = getParticipantJoinedAtKey(challenge, participant);
  const standardDuration = getStandardMissionDuration(challenge);
  const personalDone = countPersonalScheduledDays(challenge, participant);
  const remainingDays = Math.max(0, standardDuration - personalDone);

  const startDate = new Date(`${joinedKey}T00:00:00Z`);

  if (customEndDate) {
    const customKey = normalizeDateLikeToYmd(customEndDate);
    if (customKey && customKey >= joinedKey) {
      return { startDate, endDate: new Date(`${customKey}T00:00:00Z`), remainingDays };
    }
  }

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + standardDuration - 1);

  return { startDate, endDate, remainingDays };
}

function isMissionFinalDay(challenge, clientDayStr) {
  const endKey = normalizeDateLikeToYmd(challenge.endDate);
  if (!endKey || clientDayStr !== endKey) return false;
  return isDateScheduledForChallenge(challenge, clientDayStr);
}

function buildHabitMissionRewardSummary(challenge, participant) {
  const completionRate = calculateCompletionRate(challenge, participant);
  const tier = resolveMissionTier(completionRate);
  const rewards = getTierRewards(tier);
  const personalTotal = countPersonalScheduledDays(challenge, participant);
  const personalDone = countPersonalEffectiveDays(challenge, participant);
  const standardDuration = getStandardMissionDuration(challenge);

  return {
    tier,
    completionRate,
    personalTotal,
    personalDone,
    standardDuration,
    totalXp: rewards.xp,
    totalSparks: rewards.sparks,
    badge: rewards.badge,
    joinedAt: getParticipantJoinedAtKey(challenge, participant),
    isLateJoiner: isLateJoiner(challenge, participant),
    needsSoloContinuation: needsSoloContinuation(challenge, participant)
  };
}

module.exports = {
  MISSION_TIERS,
  getParticipantJoinedAtKey,
  countPersonalScheduledDays,
  countPersonalEffectiveDays,
  calculateCompletionRate,
  resolveMissionTier,
  getTierRewards,
  getStandardMissionDuration,
  isLateJoiner,
  needsSoloContinuation,
  getSoloContinuationDates,
  isMissionFinalDay,
  buildHabitMissionRewardSummary
};
