const { isValidUserId, idOf } = require('./friendshipHelpers');
const { getInclusiveDaysBetween } = require('./challengeHelpers');

const MIN_CAMPAIGN_DAYS = 7;
const MAX_CAMPAIGN_DAYS = 21;
const MAX_CAMPAIGN_MEMBERS = 8;
const CAMPAIGN_ROLES = Object.freeze({
  SHARED: 'shared',
  PERSONAL_TEMPLATE: 'personalTemplate',
  PERSONAL_CLONE: 'personalClone'
});
const OWNED_BLOCKING_STATUSES = Object.freeze(['draft', 'open', 'active']);

function serviceError(reason, status = 400) {
  const error = new Error(reason);
  error.reason = reason;
  error.status = status;
  return error;
}

function ownerIdOf(campaign) {
  return idOf(campaign?.owner);
}

function memberIds(campaign) {
  return (campaign?.members || []).map((row) => idOf(row.userId)).filter(Boolean);
}

function inviteeIds(campaign) {
  return (campaign?.invites || []).map((row) => idOf(row.userId)).filter(Boolean);
}

function isCampaignOwner(campaign, userId) {
  return Boolean(userId) && ownerIdOf(campaign) === String(userId);
}

function isCampaignMember(campaign, userId) {
  if (!userId) return false;
  return memberIds(campaign).includes(String(userId));
}

function isCampaignInvitee(campaign, userId) {
  if (!userId) return false;
  return inviteeIds(campaign).includes(String(userId));
}

function canViewCampaign(campaign, userId) {
  return (
    isCampaignOwner(campaign, userId)
    || isCampaignMember(campaign, userId)
    || isCampaignInvitee(campaign, userId)
  );
}

function guestCount(campaign) {
  const owner = ownerIdOf(campaign);
  const people = new Set([...memberIds(campaign), ...inviteeIds(campaign)]);
  people.delete(owner);
  return people.size;
}

function remainingInviteSlots(campaign) {
  return Math.max(0, MAX_CAMPAIGN_MEMBERS - 1 - guestCount(campaign));
}

function parseInviteUserIds(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const unique = [];
  const seen = new Set();
  const maxGuests = MAX_CAMPAIGN_MEMBERS - 1;
  for (const value of source) {
    const id = String(value || '').trim();
    if (!isValidUserId(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= maxGuests) break;
  }
  return unique;
}

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function campaignDurationDays(startDate, endDate) {
  return getInclusiveDaysBetween(startDate, endDate);
}

function isValidCampaignDuration(startDate, endDate) {
  const days = campaignDurationDays(startDate, endDate);
  return days >= MIN_CAMPAIGN_DAYS && days <= MAX_CAMPAIGN_DAYS;
}

function isRangeWithinCampaign(startDate, endDate, campaign) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const campaignStart = startOfDay(campaign?.startDate);
  const campaignEnd = startOfDay(campaign?.endDate);
  if (!start || !end || !campaignStart || !campaignEnd) return false;
  return start >= campaignStart && end <= campaignEnd && end >= start;
}

function hasPersonalTemplate(campaign) {
  const title = String(campaign?.personalTemplate?.title || '').trim();
  const actions = campaign?.personalTemplate?.actions;
  return Boolean(title) && Array.isArray(actions) && actions.length > 0;
}

function hasBothSlots(campaign) {
  return Boolean(campaign?.sharedChallengeId) && hasPersonalTemplate(campaign);
}

function findPersonalClone(campaign, userId) {
  if (!userId) return null;
  const id = String(userId);
  return (campaign?.personalClones || []).find((row) => idOf(row.userId) === id) || null;
}

function shouldClonePersonal(campaign, userId) {
  return Boolean(hasPersonalTemplate(campaign) && userId && !findPersonalClone(campaign, userId));
}

function resolveCampaignStatus(campaign, today = new Date()) {
  if (!campaign || campaign.status === 'draft') return 'draft';
  const end = startOfDay(campaign.endDate);
  const start = startOfDay(campaign.startDate);
  const now = startOfDay(today);
  if (!end || !start || !now) return campaign.status || 'open';
  if (end < now) return 'finished';
  if (start > now) return 'open';
  return 'active';
}

function actionIdOf(value) {
  return value?._id != null ? String(value._id) : '';
}

function collectCheckedById(actions, map = new Map()) {
  for (const action of actions || []) {
    const id = actionIdOf(action);
    if (id) map.set(id, Boolean(action.checked));
    if (Array.isArray(action.children)) collectCheckedById(action.children, map);
  }
  return map;
}

function applyCheckedOntoActions(existing, incoming) {
  const checkedById = collectCheckedById(incoming);
  function copyNode(node) {
    const plain = typeof node?.toObject === 'function' ? node.toObject() : { ...node };
    const id = actionIdOf(plain);
    const children = Array.isArray(plain.children) ? plain.children.map(copyNode) : [];
    return {
      ...(plain._id ? { _id: plain._id } : {}),
      text: typeof plain.text === 'string' ? plain.text : '',
      checked: id && checkedById.has(id) ? checkedById.get(id) : Boolean(plain.checked),
      children
    };
  }
  return (existing || []).map(copyNode);
}

function cloneActionsUnchecked(rawActions) {
  if (!Array.isArray(rawActions)) return [];

  return rawActions
    .map((action) => {
      const text = typeof action?.text === 'string' ? action.text.trim() : '';
      const children = Array.isArray(action?.children)
        ? action.children
            .map((child) => {
              const childText = typeof child?.text === 'string' ? child.text.trim() : '';
              return childText ? { text: childText, checked: false } : null;
            })
            .filter(Boolean)
        : [];

      if (!text && children.length === 0) return null;
      return { text, checked: false, children };
    })
    .filter(Boolean);
}

function snapshotPersonalTemplate(challenge) {
  return {
    challengeId: challenge?._id || challenge?.id || null,
    title: String(challenge?.title || '').trim(),
    description: String(challenge?.description || '').trim(),
    imageUrl: String(challenge?.imageUrl || ''),
    actions: cloneActionsUnchecked(challenge?.actions),
    reward: typeof challenge?.reward === 'string' ? challenge.reward.trim() : '',
    difficulty: ['easy', 'medium', 'heroic'].includes(challenge?.difficulty)
      ? challenge.difficulty
      : 'medium'
  };
}

module.exports = {
  MIN_CAMPAIGN_DAYS,
  MAX_CAMPAIGN_DAYS,
  MAX_CAMPAIGN_MEMBERS,
  CAMPAIGN_ROLES,
  OWNED_BLOCKING_STATUSES,
  serviceError,
  ownerIdOf,
  memberIds,
  inviteeIds,
  isCampaignOwner,
  isCampaignMember,
  isCampaignInvitee,
  canViewCampaign,
  guestCount,
  remainingInviteSlots,
  parseInviteUserIds,
  campaignDurationDays,
  isValidCampaignDuration,
  isRangeWithinCampaign,
  hasPersonalTemplate,
  hasBothSlots,
  findPersonalClone,
  shouldClonePersonal,
  resolveCampaignStatus,
  cloneActionsUnchecked,
  applyCheckedOntoActions,
  snapshotPersonalTemplate
};
