const SPARKS_EVENT_TYPES = Object.freeze({
  CHECKLIST_TASK: 'checklist_task',
  HABIT_DAY: 'habit_day',
  MANIFEST: 'manifest',
  STREAK_MILESTONE: 'streak_milestone',
  MISSION_COMPLETION: 'mission_completion',
  MISSION_EXTEND: 'mission_extend',
  FREEZE_DAY: 'freeze_day',
  SECOND_CHANCE: 'second_chance',
  REFERRAL: 'referral',
  SIGNUP_BONUS: 'signup_bonus'
});

const SPARKS_AMOUNTS = Object.freeze({
  TASK_COMPLETION: 2,
  QUEST_ACTION_CHECK: 1,
  QUEST_ACTION_REPORT: 3,
  MANIFEST: 10,
  STREAK_MILESTONE_BY_DAY: Object.freeze({
    3: 20,
    7: 50
  }),
  MISSION_COMPLETION: 75,
  MISSION_EXTEND: 100,
  FREEZE_DAY: 50,
  SECOND_CHANCE: 30,
  REFERRAL: 50,
  SIGNUP_BONUS: 100
});

const DAILY_SPARKS_CAP = 60;

const SPARKS_EVENT_KEY_PREFIXES = Object.freeze({
  CHECKLIST_TASK: 'sparks-checklist-task',
  HABIT_DAY: 'sparks-habit-day',
  MANIFEST: 'sparks-manifest',
  STREAK_MILESTONE: 'sparks-streak',
  MISSION_COMPLETION: 'sparks-mission-complete',
  MISSION_EXTEND: 'sparks-mission-extend',
  FREEZE_DAY: 'sparks-freeze-day',
  SECOND_CHANCE: 'sparks-second-chance',
  REFERRAL: 'sparks-referral',
  SIGNUP_BONUS: 'sparks-signup-bonus'
});

function buildChecklistTaskSparksKey(localDate, taskKey) {
  return `${SPARKS_EVENT_KEY_PREFIXES.CHECKLIST_TASK}:${localDate}:${taskKey}`;
}

function buildChecklistTaskAwardKey(task, index = 0) {
  if (task?.source?.kind === 'resultAction' && task.source.challengeId != null && task.source.actionId != null) {
    return `action:${task.source.challengeId}:${task.source.actionId}`;
  }

  const title = String(task?.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (title) return `title:${title}`;
  return `index:${index}`;
}

function buildResultActionChecklistTaskKey(challengeId, actionId) {
  return `action:${challengeId}:${actionId}`;
}

function buildHabitDaySparksKey(challengeId, localDate) {
  return `${SPARKS_EVENT_KEY_PREFIXES.HABIT_DAY}:${challengeId}:${localDate}`;
}

function buildManifestSparksKey(type, localDate, challengeId = null) {
  if (type === 'invite' && challengeId) {
    return `${SPARKS_EVENT_KEY_PREFIXES.MANIFEST}:invite:${challengeId}:${localDate}`;
  }
  return `${SPARKS_EVENT_KEY_PREFIXES.MANIFEST}:${type}:${localDate}`;
}

function buildStreakMilestoneSparksKey(milestone, localDate) {
  return `${SPARKS_EVENT_KEY_PREFIXES.STREAK_MILESTONE}:${milestone}:${localDate}`;
}

function buildMissionCompletionSparksKey(challengeId) {
  return `${SPARKS_EVENT_KEY_PREFIXES.MISSION_COMPLETION}:${challengeId}`;
}

function buildMissionExtendSparksKey(challengeId, clientDay) {
  return `${SPARKS_EVENT_KEY_PREFIXES.MISSION_EXTEND}:${challengeId}:${clientDay}`;
}

function buildFreezeDaySparksKey(userId, clientDay) {
  return `${SPARKS_EVENT_KEY_PREFIXES.FREEZE_DAY}:${userId}:${clientDay}`;
}

function buildSecondChanceSparksKey(challengeId, userId, clientDay) {
  return `${SPARKS_EVENT_KEY_PREFIXES.SECOND_CHANCE}:${challengeId}:${userId}:${clientDay}`;
}

function buildReferralSparksKey(role, referrerId, refereeId) {
  return `${SPARKS_EVENT_KEY_PREFIXES.REFERRAL}:${role}:${referrerId}:${refereeId}`;
}

function buildSignupBonusSparksKey(userId) {
  return `${SPARKS_EVENT_KEY_PREFIXES.SIGNUP_BONUS}:${userId}`;
}

function getStreakMilestoneSparks(milestone) {
  return SPARKS_AMOUNTS.STREAK_MILESTONE_BY_DAY[milestone] || 0;
}

module.exports = {
  SPARKS_EVENT_TYPES,
  SPARKS_AMOUNTS,
  DAILY_SPARKS_CAP,
  SPARKS_EVENT_KEY_PREFIXES,
  buildChecklistTaskSparksKey,
  buildChecklistTaskAwardKey,
  buildResultActionChecklistTaskKey,
  buildHabitDaySparksKey,
  buildManifestSparksKey,
  buildStreakMilestoneSparksKey,
  buildMissionCompletionSparksKey,
  buildMissionExtendSparksKey,
  buildFreezeDaySparksKey,
  buildSecondChanceSparksKey,
  buildReferralSparksKey,
  buildSignupBonusSparksKey,
  getStreakMilestoneSparks
};
