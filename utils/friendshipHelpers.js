const mongoose = require('mongoose');

const MAX_STATUS_IDS = 50;
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

function isValidUserId(id) {
  return OBJECT_ID_RE.test(String(id || ''));
}

function toObjectId(id) {
  return new mongoose.Types.ObjectId(String(id));
}

function idOf(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

function sortedPair(id1, id2) {
  const a = String(id1);
  const b = String(id2);
  if (!isValidUserId(a) || !isValidUserId(b) || a === b) return null;
  return a < b
    ? { userA: toObjectId(a), userB: toObjectId(b) }
    : { userA: toObjectId(b), userB: toObjectId(a) };
}

function involvesUser(doc, userId) {
  const id = String(userId);
  return idOf(doc?.userA) === id || idOf(doc?.userB) === id;
}

function otherUserId(doc, viewerId) {
  const viewer = String(viewerId);
  return idOf(doc.userA) === viewer ? idOf(doc.userB) : idOf(doc.userA);
}

function relationForViewer(doc, viewerId) {
  if (!doc) return { status: 'none', friendshipId: null };
  const friendshipId = idOf(doc._id) || String(doc._id);
  if (doc.status === 'accepted') return { status: 'accepted', friendshipId };
  if (idOf(doc.requesterId) === String(viewerId)) {
    return { status: 'pending_outgoing', friendshipId };
  }
  return { status: 'pending_incoming', friendshipId };
}

function parseStatusIds(raw) {
  const source = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const unique = [];
  const seen = new Set();
  for (const value of source) {
    const id = String(value || '').trim();
    if (!isValidUserId(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= MAX_STATUS_IDS) break;
  }
  return unique;
}

function serializePublicUser(user) {
  if (!user || typeof user !== 'object' || !idOf(user)) return null;
  return {
    _id: user._id,
    name: user.name,
    avatarUrl: user.avatarUrl || null,
    xp: user.xp || 0,
    sparks: user.sparks || 0,
    createdAt: user.createdAt
  };
}

function serializeFriendship(doc, viewerId) {
  const relation = relationForViewer(doc, viewerId);
  const other = idOf(doc.userA) === String(viewerId) ? doc.userB : doc.userA;
  return {
    friendshipId: relation.friendshipId,
    status: relation.status,
    user: serializePublicUser(other),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

module.exports = {
  MAX_STATUS_IDS,
  isValidUserId,
  toObjectId,
  idOf,
  sortedPair,
  involvesUser,
  otherUserId,
  relationForViewer,
  parseStatusIds,
  serializePublicUser,
  serializeFriendship
};
