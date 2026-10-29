const Friendship = require('../models/Friendship');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { notifyFriendRequest } = require('./notificationService');
const {
  isValidUserId,
  toObjectId,
  involvesUser,
  otherUserId,
  relationForViewer,
  parseStatusIds,
  serializeFriendship,
  sortedPair
} = require('./friendshipHelpers');

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

async function findPairDoc(viewerId, otherId) {
  const pair = sortedPair(viewerId, otherId);
  if (!pair) return null;
  return Friendship.findOne(pair);
}

async function clearFriendRequestNotifications(doc) {
  await Notification.deleteMany({
    type: 'friend_request',
    $or: [
      { userId: doc.userA, fromUserId: doc.userB },
      { userId: doc.userB, fromUserId: doc.userA }
    ]
  });
}

async function sendRequest(viewerId, targetId) {
  if (!isValidUserId(targetId)) throw serviceError('invalid_user', 400);
  if (String(viewerId) === String(targetId)) throw serviceError('cannot_friend_self', 400);

  const target = await User.findById(targetId).select('_id status').lean();
  if (!target || target.status === 'disabled') throw serviceError('user_not_found', 404);

  const pair = sortedPair(viewerId, targetId);
  let doc = await Friendship.findOne(pair);

  if (doc?.status === 'accepted') {
    return relationForViewer(doc, viewerId);
  }

  if (doc?.status === 'pending') {
    if (String(doc.requesterId) === String(viewerId)) {
      return relationForViewer(doc, viewerId);
    }
    return acceptRequest(viewerId, doc._id);
  }

  try {
    doc = await Friendship.create({
      ...pair,
      requesterId: toObjectId(viewerId),
      status: 'pending'
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    doc = await Friendship.findOne(pair);
    if (!doc) throw error;
    if (doc.status === 'accepted') return relationForViewer(doc, viewerId);
    if (String(doc.requesterId) !== String(viewerId)) {
      return acceptRequest(viewerId, doc._id);
    }
    return relationForViewer(doc, viewerId);
  }

  await notifyFriendRequest({
    recipientId: targetId,
    fromUserId: viewerId,
    friendshipId: doc._id
  });

  return relationForViewer(doc, viewerId);
}

async function acceptRequest(viewerId, friendshipId) {
  if (!isValidUserId(friendshipId)) throw serviceError('invalid_friendship', 400);

  const doc = await Friendship.findById(friendshipId);
  if (!doc) throw serviceError('friendship_not_found', 404);
  if (!involvesUser(doc, viewerId)) throw serviceError('forbidden', 403);
  if (doc.status === 'accepted') return relationForViewer(doc, viewerId);
  if (doc.status !== 'pending') throw serviceError('invalid_status', 400);
  if (String(doc.requesterId) === String(viewerId)) {
    throw serviceError('cannot_accept_own_request', 400);
  }

  doc.status = 'accepted';
  await doc.save();
  await clearFriendRequestNotifications(doc);
  return relationForViewer(doc, viewerId);
}

async function rejectRequest(viewerId, friendshipId) {
  if (!isValidUserId(friendshipId)) throw serviceError('invalid_friendship', 400);

  const doc = await Friendship.findById(friendshipId);
  if (!doc) throw serviceError('friendship_not_found', 404);
  if (!involvesUser(doc, viewerId)) throw serviceError('forbidden', 403);
  if (doc.status !== 'pending') throw serviceError('invalid_status', 400);

  await Friendship.deleteOne({ _id: doc._id });
  await clearFriendRequestNotifications(doc);
  return { status: 'none', friendshipId: null };
}

async function listFriends(viewerId) {
  const docs = await Friendship.find({
    status: 'accepted',
    ...pairQuery(viewerId)
  })
    .populate('userA', 'name avatarUrl xp sparks createdAt')
    .populate('userB', 'name avatarUrl xp sparks createdAt')
    .sort({ updatedAt: -1 })
    .lean();

  const friends = docs.map((doc) => serializeFriendship(doc, viewerId));

  return { friends };
}

async function listIncoming(viewerId) {
  const me = toObjectId(viewerId);
  const docs = await Friendship.find({
    status: 'pending',
    requesterId: { $ne: me },
    ...pairQuery(viewerId)
  })
    .populate('userA', 'name avatarUrl xp sparks createdAt')
    .populate('userB', 'name avatarUrl xp sparks createdAt')
    .sort({ createdAt: -1 })
    .lean();

  return { requests: docs.map((doc) => serializeFriendship(doc, viewerId)) };
}

async function countIncoming(viewerId) {
  const me = toObjectId(viewerId);
  const count = await Friendship.countDocuments({
    status: 'pending',
    requesterId: { $ne: me },
    ...pairQuery(viewerId)
  });
  return { count };
}

async function getStatus(viewerId, otherId) {
  if (!isValidUserId(otherId)) throw serviceError('invalid_user', 400);
  if (String(viewerId) === String(otherId)) {
    return { status: 'self', friendshipId: null };
  }
  const doc = await findPairDoc(viewerId, otherId);
  return relationForViewer(doc, viewerId);
}

async function getStatuses(viewerId, rawIds) {
  const ids = parseStatusIds(rawIds).filter((id) => id !== String(viewerId));
  if (ids.length === 0) return { statuses: {} };

  const me = toObjectId(viewerId);
  const others = ids.map(toObjectId);
  const docs = await Friendship.find({
    $or: [
      { userA: me, userB: { $in: others } },
      { userB: me, userA: { $in: others } }
    ]
  }).lean();

  const statuses = {};
  for (const doc of docs) {
    statuses[otherUserId(doc, viewerId)] = relationForViewer(doc, viewerId);
  }
  return { statuses };
}

module.exports = {
  sendRequest,
  acceptRequest,
  rejectRequest,
  listFriends,
  listIncoming,
  countIncoming,
  getStatus,
  getStatuses
};
