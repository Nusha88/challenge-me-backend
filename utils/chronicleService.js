const Activity = require('../models/Activity');
const ActivityCheer = require('../models/ActivityCheer');
const Challenge = require('../models/Challenge');
const Friendship = require('../models/Friendship');
const { getLevelFromXp } = require('./levelSystem');
const { otherUserId, toObjectId, isValidUserId, idOf } = require('./friendshipHelpers');
const {
  audienceForChallenge,
  shouldRecordCheckin,
  shouldRecordRitualComplete,
  buildFeedQuery,
  awardedStreakMilestones
} = require('./chronicleHelpers');

const FEED_LIMIT = 50;

function serviceError(reason, status = 400) {
  const error = new Error(reason);
  error.reason = reason;
  error.status = status;
  return error;
}

function pairQuery(viewerId) {
  const me = toObjectId(viewerId);
  return { $or: [{ userA: me }, { userB: me }] };
}

async function insertActivity(fields) {
  try {
    return await Activity.create(fields);
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function recordCheckin(challenge, actorId, addedDays, todayKey) {
  const audience = audienceForChallenge(challenge);
  if (!shouldRecordCheckin(audience, addedDays, todayKey)) return null;
  if (!isValidUserId(actorId) || !challenge?._id) return null;

  return insertActivity({
    actorId: toObjectId(actorId),
    type: 'checkin',
    audience,
    challengeId: challenge._id,
    localDate: String(todayKey),
    payload: { title: challenge.title || null }
  });
}

async function recordRitualComplete(challenge, actorId) {
  const audience = audienceForChallenge(challenge);
  if (!shouldRecordRitualComplete(audience, true)) return null;
  if (!isValidUserId(actorId) || !challenge?._id) return null;

  return insertActivity({
    actorId: toObjectId(actorId),
    type: 'ritual_complete',
    audience,
    challengeId: challenge._id,
    payload: { title: challenge.title || null }
  });
}

async function recordSquadJoined(challenge, actorId) {
  const audience = audienceForChallenge(challenge);
  if (audience !== 'squad') return null;
  if (!isValidUserId(actorId) || !challenge?._id) return null;

  return insertActivity({
    actorId: toObjectId(actorId),
    type: 'squad_joined',
    audience: 'squad',
    challengeId: challenge._id,
    payload: { title: challenge.title || null }
  });
}

async function recordSquadJoinedSafe(challenge, actorId) {
  try {
    await recordSquadJoined(challenge, actorId);
  } catch (error) {
    console.error('Chronicle squad_joined failed:', error);
  }
}

async function recordLevelUp(actorId, prevXp, nextXp) {
  if (!isValidUserId(actorId)) return null;
  const prevLevel = getLevelFromXp(prevXp);
  const nextLevel = getLevelFromXp(nextXp);
  if (!(nextLevel > prevLevel)) return null;

  return insertActivity({
    actorId: toObjectId(actorId),
    type: 'level_up',
    audience: 'public',
    payload: { level: nextLevel }
  });
}

async function recordStreakMilestones(actorId, xpResults) {
  if (!isValidUserId(actorId)) return;
  const milestones = awardedStreakMilestones(xpResults);
  await Promise.all(
    milestones.map((streak) => insertActivity({
      actorId: toObjectId(actorId),
      type: 'streak_milestone',
      audience: 'public',
      payload: { streak }
    }))
  );
}

async function recordHabitProgressChronicle({
  actorId,
  challenge,
  addedDays,
  todayKey,
  prevXp,
  nextXp,
  xpResults,
  ritualComplete = false
}) {
  try {
    await recordCheckin(challenge, actorId, addedDays, todayKey);
    if (ritualComplete) await recordRitualComplete(challenge, actorId);
    await recordLevelUp(actorId, prevXp, nextXp);
    await recordStreakMilestones(actorId, xpResults);
  } catch (error) {
    console.error('Chronicle record failed:', error);
  }
}

async function listAcceptedFriendIds(viewerId) {
  const docs = await Friendship.find({
    status: 'accepted',
    ...pairQuery(viewerId)
  }).select('userA userB').lean();
  return docs.map((doc) => otherUserId(doc, viewerId)).filter(Boolean);
}

async function listSquadChallengeIds(viewerId) {
  return Challenge.find({
    inviteOnly: true,
    challengeType: 'habit',
    'participants.userId': viewerId
  }).distinct('_id');
}

function serializeActor(actorId) {
  if (!actorId) return { _id: null, name: '', avatarUrl: null };
  if (typeof actorId === 'object' && (actorId.name != null || actorId._id)) {
    return {
      _id: actorId._id || actorId,
      name: actorId.name || '',
      avatarUrl: actorId.avatarUrl || null
    };
  }
  return { _id: actorId, name: '', avatarUrl: null };
}

function serializeActivity(doc, cheeredIds) {
  const actor = serializeActor(doc.actorId);
  const challengeId = doc.challengeId?._id || doc.challengeId || null;
  return {
    _id: doc._id,
    type: doc.type,
    createdAt: doc.createdAt,
    localDate: doc.localDate || null,
    actor,
    challengeId,
    payload: {
      title: doc.payload?.title || null,
      level: doc.payload?.level || null,
      streak: doc.payload?.streak || null
    },
    cheersCount: Math.max(0, Number(doc.cheersCount) || 0),
    cheeredByMe: cheeredIds.has(String(doc._id))
  };
}

async function listChronicle(viewerId, { cursor, limit } = {}) {
  if (!isValidUserId(viewerId)) throw serviceError('invalid_user', 400);
  const pageSize = Math.min(Math.max(Number(limit) || FEED_LIMIT, 1), FEED_LIMIT);

  const [friendIds, squadChallengeIds] = await Promise.all([
    listAcceptedFriendIds(viewerId),
    listSquadChallengeIds(viewerId)
  ]);
  const query = buildFeedQuery({
    viewerId: String(viewerId),
    friendIds,
    squadChallengeIds
  });
  if (!query) {
    return { activities: [], nextCursor: null };
  }

  if (cursor && isValidUserId(cursor)) {
    query._id = { $lt: toObjectId(cursor) };
  }

  const docs = await Activity.find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .populate('actorId', 'name avatarUrl')
    .lean();

  const hasMore = docs.length > pageSize;
  const page = hasMore ? docs.slice(0, pageSize) : docs;
  const cheeredRows = await ActivityCheer.find({
    fromUserId: toObjectId(viewerId),
    activityId: { $in: page.map((row) => row._id) }
  }).select('activityId').lean();
  const cheeredIds = new Set(cheeredRows.map((row) => String(row.activityId)));

  return {
    activities: page.map((doc) => serializeActivity(doc, cheeredIds)),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null
  };
}

async function cheerActivity(activityId, fromUserId) {
  if (!isValidUserId(activityId)) throw serviceError('invalid_activity', 400);
  if (!isValidUserId(fromUserId)) throw serviceError('invalid_user', 400);

  const activity = await Activity.findById(activityId);
  if (!activity) throw serviceError('activity_not_found', 404);
  if (idOf(activity.actorId) === String(fromUserId)) {
    throw serviceError('cannot_cheer_self', 400);
  }

  const [friendIds, squadChallengeIds] = await Promise.all([
    listAcceptedFriendIds(fromUserId),
    listSquadChallengeIds(fromUserId)
  ]);
  const visibleQuery = buildFeedQuery({
    viewerId: String(fromUserId),
    friendIds,
    squadChallengeIds
  });
  const canSee = visibleQuery && await Activity.exists({ _id: activity._id, ...visibleQuery });
  if (!canSee) throw serviceError('activity_not_found', 404);

  try {
    await ActivityCheer.create({
      activityId: activity._id,
      fromUserId: toObjectId(fromUserId)
    });
  } catch (error) {
    if (error?.code === 11000) {
      const doc = await Activity.findById(activity._id).populate('actorId', 'name avatarUrl').lean();
      if (!doc) throw serviceError('activity_not_found', 404);
      return {
        activity: serializeActivity(doc, new Set([String(activity._id)])),
        created: false,
        actorId: activity.actorId,
        challengeId: activity.challengeId
      };
    }
    throw error;
  }

  const updated = await Activity.findByIdAndUpdate(
    activity._id,
    { $inc: { cheersCount: 1 } },
    { new: true }
  ).populate('actorId', 'name avatarUrl');

  if (!updated) throw serviceError('activity_not_found', 404);

  return {
    activity: serializeActivity(updated, new Set([String(activity._id)])),
    created: true,
    actorId: activity.actorId,
    challengeId: activity.challengeId
  };
}

module.exports = {
  recordCheckin,
  recordRitualComplete,
  recordSquadJoined,
  recordSquadJoinedSafe,
  recordLevelUp,
  recordStreakMilestones,
  recordHabitProgressChronicle,
  listChronicle,
  cheerActivity
};
