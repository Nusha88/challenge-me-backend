const { isChallengeFinished } = require('./challengeHelpers');

const FEED_LIMIT = 50;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const COMMENT_WINDOW_DAYS = 7;
const PROGRESS_WINDOW_DAYS = 7;
const JOIN_WINDOW_DAYS = 30;
const FINISHED_WINDOW_DAYS = 7;

function daysAgoFrom(date) {
  return (Date.now() - date.getTime()) / MS_PER_DAY;
}

function isWithinDays(date, days) {
  if (!date) return false;
  const ago = daysAgoFrom(date);
  return ago <= days && ago >= 0;
}

function isOnOrBeforeEndDate(date, endDate) {
  if (!endDate || !date) return true;

  try {
    const end = new Date(endDate);
    const day = new Date(date);
    end.setHours(0, 0, 0, 0);
    day.setHours(0, 0, 0, 0);
    return day <= end;
  } catch {
    return true;
  }
}

function getUserDisplay(user) {
  return {
    userId: user?._id || user || null,
    userName: user?.name || 'Unknown',
    userAvatar: user?.avatarUrl || null
  };
}

function buildCommentActivities(challenge, activities) {
  if (isChallengeFinished(challenge)) return;
  if (challenge.allowComments === false) return;

  const challengeId = String(challenge._id);
  const challengeTitle = challenge.title || '';

  for (const comment of challenge.comments || []) {
    const createdAt = comment.createdAt ? new Date(comment.createdAt) : null;
    if (!createdAt || !isWithinDays(createdAt, COMMENT_WINDOW_DAYS)) continue;

    const user = comment.userId;
    const { userId, userName, userAvatar } = getUserDisplay(user);

    activities.push({
      id: `comment-${challengeId}-${comment._id}`,
      type: 'comment',
      timestamp: createdAt,
      userId,
      userName,
      userAvatar,
      challengeId,
      challengeTitle,
      commentId: comment._id ? String(comment._id) : null
    });
  }
}

function pushFinishedActivities(challenge, activities) {
  const challengeId = String(challenge._id);
  const challengeTitle = challenge.title || '';

  for (const participant of challenge.participants || []) {
    const completedDays = participant.completedDays || [];
    if (!completedDays.length) continue;

    const lastCompleted = completedDays[completedDays.length - 1];
    if (!lastCompleted) continue;

    const lastDate = new Date(lastCompleted);
    if (!isWithinDays(lastDate, FINISHED_WINDOW_DAYS)) continue;

    const user = participant.userId;
    const { userId, userName, userAvatar } = getUserDisplay(user);

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

function buildLiveParticipantActivities(challenge, activities) {
  if (!Array.isArray(challenge.participants)) return;

  const challengeId = String(challenge._id);
  const challengeTitle = challenge.title || '';

  for (const participant of challenge.participants) {
    const user = participant.userId;
    const { userId, userName, userAvatar } = getUserDisplay(user);
    const completedDays = participant.completedDays || [];
    if (!completedDays.length) continue;

    const firstDay = completedDays[0];
    if (firstDay) {
      const joinDate = new Date(firstDay);
      if (isWithinDays(joinDate, JOIN_WINDOW_DAYS)) {
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
      .filter((date) => (
        isWithinDays(date, PROGRESS_WINDOW_DAYS)
        && isOnOrBeforeEndDate(date, challenge.endDate)
      ))
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

function buildParticipantActivities(challenge, activities) {
  if (isChallengeFinished(challenge)) {
    pushFinishedActivities(challenge, activities);
    return;
  }

  buildLiveParticipantActivities(challenge, activities);
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
