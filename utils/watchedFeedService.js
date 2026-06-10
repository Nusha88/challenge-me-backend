const { isResultChallengeCompleted } = require('./challengeHelpers');

const FEED_LIMIT = 50;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isPastEndDate(endDate) {
  if (!endDate) return false;

  try {
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return end < today;
  } catch {
    return false;
  }
}

function isChallengeFinished(challenge) {
  if (!challenge) return false;

  if (isPastEndDate(challenge.endDate)) {
    return true;
  }

  if (challenge.challengeType === 'result') {
    return isResultChallengeCompleted(challenge.actions);
  }

  return false;
}

function getUserDisplay(user) {
  return {
    userId: user?._id || user || null,
    userName: user?.name || 'Unknown',
    userAvatar: user?.avatarUrl || null
  };
}

function daysAgoFrom(date) {
  return (Date.now() - date.getTime()) / MS_PER_DAY;
}

function buildCommentActivities(challenge, activities) {
  if (challenge.allowComments === false) return;

  const challengeId = String(challenge._id);
  const challengeTitle = challenge.title || '';

  for (const comment of challenge.comments || []) {
    const user = comment.userId;
    const { userId, userName, userAvatar } = getUserDisplay(user);

    activities.push({
      id: `comment-${challengeId}-${comment._id}`,
      type: 'comment',
      timestamp: new Date(comment.createdAt),
      userId,
      userName,
      userAvatar,
      challengeId,
      challengeTitle
    });
  }
}

function buildParticipantActivities(challenge, activities) {
  if (!Array.isArray(challenge.participants)) return;

  const challengeId = String(challenge._id);
  const challengeTitle = challenge.title || '';
  const isFinished = isChallengeFinished(challenge);

  for (const participant of challenge.participants) {
    const user = participant.userId;
    const { userId, userName, userAvatar } = getUserDisplay(user);
    const completedDays = participant.completedDays || [];

    if (isFinished && completedDays.length > 0) {
      const lastCompleted = completedDays[completedDays.length - 1];
      if (lastCompleted) {
        const lastDate = new Date(lastCompleted);
        if (daysAgoFrom(lastDate) <= 7) {
          activities.push({
            id: `finished-${challengeId}-${userId}`,
            type: 'finished',
            timestamp: lastDate,
            userId,
            userName,
            userAvatar,
            challengeId,
            challengeTitle
          });
        }
      }
    }

    if (completedDays.length > 0) {
      const firstDay = completedDays[0];
      if (firstDay) {
        const joinDate = new Date(firstDay);
        if (daysAgoFrom(joinDate) <= 30) {
          activities.push({
            id: `join-${challengeId}-${userId}`,
            type: 'join',
            timestamp: joinDate,
            userId,
            userName,
            userAvatar,
            challengeId,
            challengeTitle
          });
        }
      }

      completedDays
        .map((day) => new Date(day))
        .filter((date) => {
          const daysAgo = daysAgoFrom(date);
          return daysAgo <= 7 && daysAgo >= 0;
        })
        .sort((a, b) => b - a)
        .forEach((dayDate) => {
          activities.push({
            id: `progress-${challengeId}-${userId}-${dayDate.toISOString()}`,
            type: 'progress',
            timestamp: dayDate,
            userId,
            userName,
            userAvatar,
            challengeId,
            challengeTitle
          });
        });
    }
  }
}

function buildWatchedFeedActivities(challenges, { limit = FEED_LIMIT } = {}) {
  const activities = [];

  for (const challenge of challenges || []) {
    const challengeObj =
      typeof challenge.toObject === 'function' ? challenge.toObject() : challenge;

    buildCommentActivities(challengeObj, activities);
    buildParticipantActivities(challengeObj, activities);
  }

  return activities
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit)
    .map((activity) => ({
      ...activity,
      timestamp: new Date(activity.timestamp).toISOString()
    }));
}

module.exports = {
  buildWatchedFeedActivities,
  isChallengeFinished
};
