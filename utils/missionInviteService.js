const Challenge = require('../models/Challenge');
const Friendship = require('../models/Friendship');
const Notification = require('../models/Notification');
const { notifyMissionInvite, notifyChallengeJoin } = require('./notificationService');
const { recordSquadJoinedSafe } = require('./chronicleService');
const { sortedPair, toObjectId, isValidUserId, idOf } = require('./friendshipHelpers');
const {
  parseInviteUserIds,
  isChallengeOwner,
  isChallengeParticipant,
  isChallengeInvitee,
  remainingInviteSlots,
  participantIds,
  inviteeIds
} = require('./missionInviteHelpers');

function serviceError(reason, status = 400) {
  const error = new Error(reason);
  error.reason = reason;
  error.status = status;
  return error;
}

async function areAcceptedFriends(userA, userB) {
  const pair = sortedPair(userA, userB);
  if (!pair) return false;
  const doc = await Friendship.findOne({ ...pair, status: 'accepted' }).select('_id').lean();
  return Boolean(doc);
}

async function loadChallenge(challengeId) {
  if (!isValidUserId(challengeId)) throw serviceError('invalid_challenge', 400);
  const challenge = await Challenge.findById(challengeId);
  if (!challenge) throw serviceError('challenge_not_found', 404);
  return challenge;
}

function assertSquadRitual(challenge) {
  if (challenge.challengeType !== 'habit') throw serviceError('not_a_ritual', 400);
  if (!challenge.inviteOnly) throw serviceError('not_invite_only', 400);
}

async function clearMissionInviteNotifications(challengeId, userId) {
  await Notification.deleteMany({
    type: 'mission_invite',
    challengeId,
    userId
  });
}

async function populateChallenge(challengeId) {
  return Challenge.findById(challengeId)
    .populate('owner', 'name avatarUrl')
    .populate('participants.userId', 'name avatarUrl')
    .populate('invites.userId', 'name avatarUrl');
}

async function sendInvites(challenge, ownerId, rawUserIds, { joinDate } = {}) {
  assertSquadRitual(challenge);
  if (!isChallengeOwner(challenge, ownerId)) throw serviceError('forbidden', 403);

  const owner = String(ownerId);
  const requested = parseInviteUserIds(rawUserIds).filter((id) => id !== owner);
  if (requested.length === 0) return { invited: [], skipped: [] };

  const alreadyIn = new Set([...participantIds(challenge), ...inviteeIds(challenge)]);
  let slots = remainingInviteSlots(challenge);
  const invited = [];
  const skipped = [];

  for (const userId of requested) {
    if (alreadyIn.has(userId)) {
      skipped.push({ userId, reason: 'already_member' });
      continue;
    }
    if (slots <= 0) {
      skipped.push({ userId, reason: 'squad_full' });
      continue;
    }
    const isFriend = await areAcceptedFriends(owner, userId);
    if (!isFriend) {
      skipped.push({ userId, reason: 'not_in_squad' });
      continue;
    }

    challenge.invites.push({
      userId: toObjectId(userId),
      invitedBy: toObjectId(owner),
      createdAt: joinDate || new Date()
    });
    alreadyIn.add(userId);
    slots -= 1;
    invited.push(userId);
  }

  if (invited.length > 0) {
    await challenge.save();
    await Promise.all(
      invited.map((userId) => notifyMissionInvite({
        recipientId: userId,
        fromUserId: owner,
        challenge
      }))
    );
  }

  return { invited, skipped };
}

async function inviteUsers(challengeId, ownerId, rawUserIds) {
  const challenge = await loadChallenge(challengeId);
  await sendInvites(challenge, ownerId, rawUserIds);
  return populateChallenge(challenge._id);
}

async function acceptInvite(challengeId, userId, joinDate) {
  const challenge = await loadChallenge(challengeId);
  assertSquadRitual(challenge);
  if (!isChallengeInvitee(challenge, userId)) throw serviceError('invite_not_found', 404);
  if (isChallengeParticipant(challenge, userId)) {
    challenge.invites = challenge.invites.filter((row) => idOf(row.userId) !== String(userId));
    await challenge.save();
    await clearMissionInviteNotifications(challenge._id, userId);
    return populateChallenge(challenge._id);
  }

  const updated = await Challenge.findOneAndUpdate(
    {
      _id: challenge._id,
      'participants.userId': { $ne: toObjectId(userId) },
      'invites.userId': toObjectId(userId)
    },
    {
      $push: {
        participants: {
          userId: toObjectId(userId),
          completedDays: [],
          joinedAt: joinDate || new Date()
        }
      },
      $pull: { invites: { userId: toObjectId(userId) } }
    },
    { new: true }
  );

  if (!updated) throw serviceError('invite_not_found', 404);

  await clearMissionInviteNotifications(updated._id, userId);
  const ownerId = updated.owner?._id || updated.owner;
  await notifyChallengeJoin({ ownerId, fromUserId: userId, challenge: updated });
  void recordSquadJoinedSafe(updated, userId);
  return populateChallenge(updated._id);
}

async function rejectInvite(challengeId, userId) {
  const challenge = await loadChallenge(challengeId);
  assertSquadRitual(challenge);
  if (!isChallengeInvitee(challenge, userId)) throw serviceError('invite_not_found', 404);

  challenge.invites = challenge.invites.filter((row) => idOf(row.userId) !== String(userId));
  await challenge.save();
  await clearMissionInviteNotifications(challenge._id, userId);
  return { status: 'none' };
}

async function cancelInvite(challengeId, ownerId, targetUserId) {
  const challenge = await loadChallenge(challengeId);
  assertSquadRitual(challenge);
  if (!isChallengeOwner(challenge, ownerId)) throw serviceError('forbidden', 403);
  if (!isValidUserId(targetUserId)) throw serviceError('invalid_user', 400);
  if (!isChallengeInvitee(challenge, targetUserId)) throw serviceError('invite_not_found', 404);

  challenge.invites = challenge.invites.filter((row) => idOf(row.userId) !== String(targetUserId));
  await challenge.save();
  await clearMissionInviteNotifications(challenge._id, targetUserId);
  return populateChallenge(challenge._id);
}

module.exports = {
  sendInvites,
  inviteUsers,
  acceptInvite,
  rejectInvite,
  cancelInvite,
  populateChallenge
};
