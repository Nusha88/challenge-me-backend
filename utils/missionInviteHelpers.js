const { isValidUserId, idOf } = require('./friendshipHelpers');

const MAX_SQUAD_GUESTS = 12;

function parseInviteUserIds(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const unique = [];
  const seen = new Set();
  for (const value of source) {
    const id = String(value || '').trim();
    if (!isValidUserId(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= MAX_SQUAD_GUESTS) break;
  }
  return unique;
}

function ownerIdOf(challenge) {
  return idOf(challenge?.owner);
}

function participantIds(challenge) {
  return (challenge?.participants || []).map((row) => idOf(row.userId)).filter(Boolean);
}

function inviteeIds(challenge) {
  return (challenge?.invites || []).map((row) => idOf(row.userId)).filter(Boolean);
}

function isChallengeOwner(challenge, userId) {
  return Boolean(userId) && ownerIdOf(challenge) === String(userId);
}

function isChallengeParticipant(challenge, userId) {
  if (!userId) return false;
  return participantIds(challenge).includes(String(userId));
}

function isChallengeInvitee(challenge, userId) {
  if (!userId) return false;
  return inviteeIds(challenge).includes(String(userId));
}

function guestCount(challenge) {
  const owner = ownerIdOf(challenge);
  const members = new Set([...participantIds(challenge), ...inviteeIds(challenge)]);
  members.delete(owner);
  return members.size;
}

function remainingInviteSlots(challenge) {
  return Math.max(0, MAX_SQUAD_GUESTS - guestCount(challenge));
}

function canViewInviteOnlyChallenge(challenge, viewerId) {
  if (!challenge?.inviteOnly) return true;
  return (
    isChallengeOwner(challenge, viewerId)
    || isChallengeParticipant(challenge, viewerId)
    || isChallengeInvitee(challenge, viewerId)
  );
}

function serializeInvite(row) {
  const user = row?.userId && typeof row.userId === 'object' && row.userId._id
    ? {
        _id: row.userId._id,
        name: row.userId.name,
        avatarUrl: row.userId.avatarUrl || null
      }
    : { _id: row?.userId };
  return {
    userId: user,
    invitedBy: idOf(row?.invitedBy),
    createdAt: row?.createdAt || null
  };
}

module.exports = {
  MAX_SQUAD_GUESTS,
  parseInviteUserIds,
  ownerIdOf,
  participantIds,
  inviteeIds,
  isChallengeOwner,
  isChallengeParticipant,
  isChallengeInvitee,
  guestCount,
  remainingInviteSlots,
  canViewInviteOnlyChallenge,
  serializeInvite
};
