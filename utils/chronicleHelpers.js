const ACTIVITY_TYPES = Object.freeze([
  'checkin',
  'ritual_complete',
  'squad_joined',
  'level_up',
  'streak_milestone'
]);

const STREAK_FEED_MILESTONES = Object.freeze([7, 14]);

function audienceForChallenge(challenge) {
  if (!challenge) return null;
  if (challenge.inviteOnly && challenge.challengeType === 'habit') return 'squad';
  if (challenge.privacy === 'public') return 'public';
  return null;
}

function shouldRecordCheckin(audience, addedDays, todayKey) {
  if (!audience || !todayKey) return false;
  return (addedDays || []).some((day) => String(day) === String(todayKey));
}

function shouldRecordRitualComplete(audience, ritualComplete) {
  return Boolean(audience && ritualComplete);
}

function buildFeedQuery({ viewerId, friendIds, squadChallengeIds }) {
  const viewer = String(viewerId || '');
  const friends = (friendIds || []).map(String).filter((id) => id && id !== viewer);
  const squadIds = (squadChallengeIds || []).filter(Boolean);

  const or = [];
  if (friends.length > 0) {
    or.push({ actorId: { $in: friends }, audience: 'public' });
  }
  if (squadIds.length > 0) {
    or.push({ challengeId: { $in: squadIds }, audience: 'squad' });
  }
  if (or.length === 0) return null;

  return {
    actorId: { $ne: viewer },
    $or: or
  };
}

function checkinDedupeFilter(actorId, challengeId, localDate) {
  return {
    actorId,
    type: 'checkin',
    challengeId,
    localDate
  };
}

function awardedStreakMilestones(xpResults) {
  const seen = new Set();
  const milestones = [];
  for (const result of xpResults || []) {
    const milestone = Number(result?.meta?.milestone);
    if (!result?.awarded || !STREAK_FEED_MILESTONES.includes(milestone) || seen.has(milestone)) {
      continue;
    }
    seen.add(milestone);
    milestones.push(milestone);
  }
  return milestones;
}

module.exports = {
  ACTIVITY_TYPES,
  STREAK_FEED_MILESTONES,
  audienceForChallenge,
  shouldRecordCheckin,
  shouldRecordRitualComplete,
  buildFeedQuery,
  checkinDedupeFilter,
  awardedStreakMilestones
};
