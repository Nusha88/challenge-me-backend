const Campaign = require('../models/Campaign');
const Challenge = require('../models/Challenge');
const Friendship = require('../models/Friendship');
const Notification = require('../models/Notification');
const { notifyCampaignInvite, notifyChallengeJoin } = require('./notificationService');
const { recordSquadJoinedSafe } = require('./chronicleService');
const { spendSparksOnce } = require('./sparksService');
const { sortedPair, toObjectId, isValidUserId, idOf } = require('./friendshipHelpers');
const {
  CAMPAIGN_ROLES,
  OWNED_BLOCKING_STATUSES,
  EXTRA_SHARED_MAX,
  EXTRA_PERSONAL_MAX,
  EXTRA_SLOT_COST,
  serviceError,
  isCampaignOwner,
  isCampaignMember,
  isCampaignInvitee,
  canViewCampaign,
  remainingInviteSlots,
  parseInviteUserIds,
  isValidCampaignDuration,
  isRangeWithinCampaign,
  hasBothSlots,
  hasPersonalTemplate,
  extraSlotSpendKey,
  extraSharedIds,
  extraPersonalTemplates,
  sharedChallengeIds,
  personalTemplates,
  canAddExtraShared,
  canAddExtraPersonal,
  findPersonalClone,
  shouldClonePersonal,
  resolveCampaignStatus,
  cloneActionsUnchecked,
  snapshotPersonalTemplate,
  applyCheckedOntoActions,
  ownerIdOf
} = require('./campaignHelpers');

async function areAcceptedFriends(userA, userB) {
  const pair = sortedPair(userA, userB);
  if (!pair) return false;
  const doc = await Friendship.findOne({ ...pair, status: 'accepted' }).select('_id').lean();
  return Boolean(doc);
}

function populateCampaign(campaignId) {
  return Campaign.findById(campaignId)
    .populate('owner', 'name avatarUrl')
    .populate('members.userId', 'name avatarUrl')
    .populate('invites.userId', 'name avatarUrl')
    .populate('sharedChallengeId', 'title challengeType startDate endDate inviteOnly privacy campaignRole')
    .populate('extraSharedChallengeIds', 'title challengeType startDate endDate inviteOnly privacy campaignRole')
    .populate('personalClones.challengeId', 'title challengeType startDate endDate campaignRole');
}

function withLiveStatus(campaign, today = new Date()) {
  if (!campaign) return campaign;
  const plain = typeof campaign.toObject === 'function' ? campaign.toObject() : { ...campaign };
  plain.status = resolveCampaignStatus(plain, today);
  return plain;
}

function templateChallengeIdFrom(campaign) {
  const value = campaign?.personalTemplate?.challengeId;
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

function emptyPersonalTemplate() {
  return {
    challengeId: null,
    title: '',
    description: '',
    imageUrl: '',
    actions: [],
    reward: '',
    difficulty: 'medium'
  };
}

function withSpend(campaignPayload, spendResult = null) {
  return {
    campaign: campaignPayload,
    sparksSpent: Number(spendResult?.sparksSpent || 0),
    user: spendResult?.user || null
  };
}

async function spendExtraSlot(ownerId, campaignId, kind) {
  const result = await spendSparksOnce(
    ownerId,
    extraSlotSpendKey(campaignId, kind, 1),
    EXTRA_SLOT_COST,
    { campaignId: String(campaignId), kind }
  );
  if (result.success) return result;
  if (result.reason === 'already_spent') {
    return { success: true, sparksSpent: 0, user: result.user || null, reason: 'already_spent' };
  }
  if (result.reason === 'insufficient_sparks') {
    throw serviceError('insufficient_sparks', 402);
  }
  throw serviceError(result.reason || 'unable_to_spend', 400);
}

function isSameChallenge(value, challengeId) {
  return Boolean(challengeId) && idOf(value) === String(challengeId);
}

function extraPersonalIndexForChallenge(campaign, challengeId) {
  const extras = campaign?.extraPersonalTemplates || [];
  return extras.findIndex((template) => isSameChallenge(template.challengeId, challengeId));
}

async function presentCampaign(campaignId) {
  const plain = withLiveStatus(await populateCampaign(campaignId));
  plain.personalTemplateChallengeId = templateChallengeIdFrom(plain)
    || await findPersonalTemplateChallengeId(campaignId);
  return plain;
}

async function loadCampaign(campaignId) {
  if (!isValidUserId(campaignId)) throw serviceError('invalid_campaign', 400);
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw serviceError('campaign_not_found', 404);
  return campaign;
}

async function assertNoBlockingOwnedCampaign(ownerId, exceptId = null) {
  const query = {
    owner: ownerId,
    status: { $in: OWNED_BLOCKING_STATUSES }
  };
  if (exceptId) query._id = { $ne: exceptId };
  const existing = await Campaign.findOne(query).select('_id').lean();
  if (existing) throw serviceError('campaign_limit', 409);
}

async function queueInvites(campaign, ownerId, rawUserIds) {
  const owner = String(ownerId);
  const requested = parseInviteUserIds(rawUserIds).filter((id) => id !== owner);
  if (requested.length === 0) return { invited: [], skipped: [] };

  const alreadyIn = new Set([
    ...((campaign.members || []).map((row) => idOf(row.userId))),
    ...((campaign.invites || []).map((row) => idOf(row.userId)))
  ]);
  let slots = remainingInviteSlots(campaign);
  const invited = [];
  const skipped = [];

  for (const userId of requested) {
    if (alreadyIn.has(userId)) {
      skipped.push({ userId, reason: 'already_member' });
      continue;
    }
    if (slots <= 0) {
      skipped.push({ userId, reason: 'campaign_full' });
      continue;
    }
    const isFriend = await areAcceptedFriends(owner, userId);
    if (!isFriend) {
      skipped.push({ userId, reason: 'not_in_squad' });
      continue;
    }

    campaign.invites.push({
      userId: toObjectId(userId),
      invitedBy: toObjectId(owner),
      createdAt: new Date()
    });
    alreadyIn.add(userId);
    slots -= 1;
    invited.push(userId);
  }

  return { invited, skipped };
}

async function createDraft(ownerId, payload = {}) {
  const title = String(payload.title || '').trim();
  if (!title) throw serviceError('title_required', 400);
  if (!payload.startDate || !payload.endDate) throw serviceError('dates_required', 400);
  if (!isValidCampaignDuration(payload.startDate, payload.endDate)) {
    throw serviceError('invalid_duration', 400);
  }

  await assertNoBlockingOwnedCampaign(ownerId);

  const startDate = new Date(payload.startDate);
  const endDate = new Date(payload.endDate);
  const campaign = new Campaign({
    title,
    description: typeof payload.description === 'string' ? payload.description.trim() : '',
    imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : '',
    startDate,
    endDate,
    owner: ownerId,
    status: 'draft',
    members: [{ userId: ownerId, joinedAt: startDate }]
  });

  await queueInvites(campaign, ownerId, payload.inviteUserIds);
  await campaign.save();
  return presentCampaign(campaign._id);
}

async function updateDraft(campaignId, ownerId, payload = {}) {
  const campaign = await loadCampaign(campaignId);
  if (!isCampaignOwner(campaign, ownerId)) throw serviceError('forbidden', 403);
  if (campaign.status !== 'draft') throw serviceError('not_draft', 400);

  if (payload.title !== undefined) {
    const title = String(payload.title || '').trim();
    if (!title) throw serviceError('title_required', 400);
    campaign.title = title;
  }
  if (payload.description !== undefined) {
    campaign.description = String(payload.description || '').trim();
  }
  if (payload.imageUrl !== undefined) {
    campaign.imageUrl = String(payload.imageUrl || '');
  }

  const nextStart = payload.startDate ? new Date(payload.startDate) : campaign.startDate;
  const nextEnd = payload.endDate ? new Date(payload.endDate) : campaign.endDate;
  if (!isValidCampaignDuration(nextStart, nextEnd)) {
    throw serviceError('invalid_duration', 400);
  }
  campaign.startDate = nextStart;
  campaign.endDate = nextEnd;

  if (payload.inviteUserIds !== undefined) {
    campaign.invites = [];
    await queueInvites(campaign, ownerId, payload.inviteUserIds);
  }

  await campaign.save();

  const datePatch = { startDate: campaign.startDate, endDate: campaign.endDate };
  await Challenge.updateMany(
    { campaignId: campaign._id, campaignRole: { $in: [CAMPAIGN_ROLES.SHARED, CAMPAIGN_ROLES.PERSONAL_TEMPLATE] } },
    { $set: datePatch }
  );

  return presentCampaign(campaign._id);
}

function assertDraftOwner(campaign, ownerId) {
  if (!isCampaignOwner(campaign, ownerId)) throw serviceError('forbidden', 403);
  if (campaign.status !== 'draft') throw serviceError('not_draft', 400);
}

async function deleteDraft(campaignId, ownerId) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);

  await Challenge.deleteMany({ campaignId: campaign._id });
  await Notification.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
  return { status: 'deleted' };
}

async function prepareCreatedChallenge(campaignId, ownerId, fields = {}) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);

  const role = fields.campaignRole;
  if (role !== CAMPAIGN_ROLES.SHARED && role !== CAMPAIGN_ROLES.PERSONAL_TEMPLATE) {
    throw serviceError('invalid_slot', 400);
  }
  if (!isRangeWithinCampaign(fields.startDate || campaign.startDate, fields.endDate || campaign.endDate, campaign)) {
    throw serviceError('dates_outside_campaign', 400);
  }

  if (role === CAMPAIGN_ROLES.SHARED) {
    if (campaign.sharedChallengeId && !canAddExtraShared(campaign)) {
      throw serviceError('shared_taken', 409);
    }
    if (fields.challengeType && fields.challengeType !== 'habit') {
      throw serviceError('not_a_ritual', 400);
    }
    return {
      campaign,
      extra: Boolean(campaign.sharedChallengeId),
      challengePatch: {
        campaignId: campaign._id,
        campaignRole: CAMPAIGN_ROLES.SHARED,
        challengeType: 'habit',
        privacy: 'private',
        inviteOnly: true,
        allowComments: true,
        startDate: campaign.startDate,
        endDate: campaign.endDate
      }
    };
  }

  if (hasPersonalTemplate(campaign) && !canAddExtraPersonal(campaign)) {
    throw serviceError('personal_taken', 409);
  }
  if (fields.challengeType && fields.challengeType !== 'result') {
    throw serviceError('not_a_quest', 400);
  }
  return {
    campaign,
    extra: hasPersonalTemplate(campaign),
    challengePatch: {
      campaignId: campaign._id,
      campaignRole: CAMPAIGN_ROLES.PERSONAL_TEMPLATE,
      challengeType: 'result',
      privacy: 'private',
      inviteOnly: false,
      visibility: false,
      startDate: campaign.startDate,
      endDate: campaign.endDate
    }
  };
}

async function assignSharedChallenge(campaign, ownerId, challenge) {
  if (isSameChallenge(campaign.sharedChallengeId, challenge._id)) {
    return withSpend(await presentCampaign(campaign._id));
  }
  if (extraSharedIds(campaign).includes(String(challenge._id))) {
    return withSpend(await presentCampaign(campaign._id));
  }
  if (!campaign.sharedChallengeId) {
    campaign.sharedChallengeId = challenge._id;
    await campaign.save();
    return withSpend(await presentCampaign(campaign._id));
  }
  if (extraSharedIds(campaign).length >= EXTRA_SHARED_MAX) {
    throw serviceError('shared_taken', 409);
  }
  const spendResult = await spendExtraSlot(ownerId, campaign._id, 'shared');
  campaign.extraSharedUnlocked = true;
  campaign.extraSharedChallengeIds = campaign.extraSharedChallengeIds || [];
  campaign.extraSharedChallengeIds.push(challenge._id);
  await campaign.save();
  return withSpend(await presentCampaign(campaign._id), spendResult);
}

async function assignPersonalTemplate(campaign, ownerId, snapshot) {
  const challengeId = snapshot?.challengeId;
  if (isSameChallenge(campaign.personalTemplate?.challengeId, challengeId)) {
    campaign.personalTemplate = snapshot;
    await campaign.save();
    return withSpend(await presentCampaign(campaign._id));
  }
  const extraIndex = extraPersonalIndexForChallenge(campaign, challengeId);
  if (extraIndex >= 0) {
    campaign.extraPersonalTemplates.set(extraIndex, snapshot);
    campaign.markModified('extraPersonalTemplates');
    await campaign.save();
    return withSpend(await presentCampaign(campaign._id));
  }
  if (!hasPersonalTemplate(campaign)) {
    campaign.personalTemplate = snapshot;
    await campaign.save();
    return withSpend(await presentCampaign(campaign._id));
  }
  if (extraPersonalTemplates(campaign).length >= EXTRA_PERSONAL_MAX) {
    throw serviceError('personal_taken', 409);
  }
  const spendResult = await spendExtraSlot(ownerId, campaign._id, 'personal');
  campaign.extraPersonalUnlocked = true;
  campaign.extraPersonalTemplates = campaign.extraPersonalTemplates || [];
  campaign.extraPersonalTemplates.push(snapshot);
  await campaign.save();
  return withSpend(await presentCampaign(campaign._id), spendResult);
}

async function finalizeCreatedChallenge(campaignId, ownerId, challenge) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);

  if (challenge.campaignRole === CAMPAIGN_ROLES.SHARED) {
    return assignSharedChallenge(campaign, ownerId, challenge);
  }

  if (challenge.campaignRole === CAMPAIGN_ROLES.PERSONAL_TEMPLATE) {
    return assignPersonalTemplate(campaign, ownerId, snapshotPersonalTemplate(challenge));
  }

  throw serviceError('invalid_slot', 400);
}

async function attachSharedSlot(campaignId, ownerId, challengeId) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);
  if (campaign.sharedChallengeId && !canAddExtraShared(campaign)) {
    throw serviceError('shared_taken', 409);
  }
  if (!isValidUserId(challengeId)) throw serviceError('invalid_challenge', 400);

  const challenge = await Challenge.findById(challengeId);
  if (!challenge) throw serviceError('challenge_not_found', 404);
  if (idOf(challenge.owner) !== String(ownerId)) throw serviceError('forbidden', 403);
  if (challenge.challengeType !== 'habit') throw serviceError('not_a_ritual', 400);

  challenge.campaignId = campaign._id;
  challenge.campaignRole = CAMPAIGN_ROLES.SHARED;
  challenge.privacy = 'private';
  challenge.inviteOnly = true;
  challenge.allowComments = true;
  challenge.startDate = campaign.startDate;
  challenge.endDate = campaign.endDate;
  challenge.invites = [];
  await challenge.save();

  return assignSharedChallenge(campaign, ownerId, challenge);
}

async function attachPersonalSlot(campaignId, ownerId, payload = {}) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);
  if (hasPersonalTemplate(campaign) && !canAddExtraPersonal(campaign)) {
    throw serviceError('personal_taken', 409);
  }

  let snapshot;
  if (payload.challengeId) {
    if (!isValidUserId(payload.challengeId)) throw serviceError('invalid_challenge', 400);
    const challenge = await Challenge.findById(payload.challengeId);
    if (!challenge) throw serviceError('challenge_not_found', 404);
    if (idOf(challenge.owner) !== String(ownerId)) throw serviceError('forbidden', 403);
    if (challenge.challengeType !== 'result') throw serviceError('not_a_quest', 400);
    challenge.campaignId = campaign._id;
    challenge.campaignRole = CAMPAIGN_ROLES.PERSONAL_TEMPLATE;
    challenge.privacy = 'private';
    challenge.visibility = false;
    challenge.startDate = campaign.startDate;
    challenge.endDate = campaign.endDate;
    await challenge.save();
    snapshot = snapshotPersonalTemplate(challenge);
  } else {
    snapshot = snapshotPersonalTemplate(payload);
    if (!snapshot.title || snapshot.actions.length === 0) {
      throw serviceError('personal_incomplete', 400);
    }
  }

  return assignPersonalTemplate(campaign, ownerId, snapshot);
}

async function cloneOnePersonalTemplate(campaign, userId, joinDate, template) {
  const sourceId = idOf(template?.challengeId);
  const existing = findPersonalClone(campaign, userId, sourceId);
  if (existing) return existing.challengeId;

  let snapshot = template;
  if (sourceId) {
    const source = await Challenge.findById(sourceId);
    if (source) snapshot = snapshotPersonalTemplate(source);
  }
  if (!snapshot?.title || !Array.isArray(snapshot.actions) || snapshot.actions.length === 0) {
    throw serviceError('personal_incomplete', 400);
  }

  const cloned = new Challenge({
    title: snapshot.title,
    description: snapshot.description || '',
    imageUrl: snapshot.imageUrl || '',
    privacy: 'private',
    inviteOnly: false,
    visibility: true,
    challengeType: 'result',
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    owner: userId,
    difficulty: snapshot.difficulty || 'medium',
    reward: snapshot.reward || '',
    actions: cloneActionsUnchecked(snapshot.actions),
    allowComments: false,
    campaignId: campaign._id,
    campaignRole: CAMPAIGN_ROLES.PERSONAL_CLONE,
    participants: [{
      userId,
      completedDays: [],
      joinedAt: joinDate || campaign.startDate || new Date()
    }]
  });
  await cloned.save();

  campaign.personalClones.push({
    userId: toObjectId(userId),
    challengeId: cloned._id,
    sourceChallengeId: sourceId ? toObjectId(sourceId) : null
  });
  return cloned._id;
}

async function clonePersonalQuest(campaign, userId, joinDate) {
  const templates = personalTemplates(campaign);
  if (templates.length === 0) throw serviceError('personal_incomplete', 400);
  let lastId = null;
  for (const template of templates) {
    lastId = await cloneOnePersonalTemplate(campaign, userId, joinDate, template);
  }
  return lastId;
}

async function joinOneSharedRitual(challengeId, userId, joinDate, campaign) {
  const updated = await Challenge.findOneAndUpdate(
    {
      _id: challengeId,
      'participants.userId': { $ne: toObjectId(userId) }
    },
    {
      $push: {
        participants: {
          userId: toObjectId(userId),
          completedDays: [],
          joinedAt: joinDate || campaign.startDate || new Date()
        }
      }
    },
    { new: true }
  );
  if (updated) {
    const ownerId = updated.owner?._id || updated.owner;
    if (String(ownerId) !== String(userId)) {
      await notifyChallengeJoin({ ownerId, fromUserId: userId, challenge: updated });
      void recordSquadJoinedSafe(updated, userId);
    }
  }
  return updated;
}

async function joinSharedRitual(campaign, userId, joinDate) {
  const ids = sharedChallengeIds(campaign);
  if (ids.length === 0) throw serviceError('shared_missing', 400);
  let last = null;
  for (const challengeId of ids) {
    last = await joinOneSharedRitual(challengeId, userId, joinDate, campaign);
  }
  return last;
}

async function pullFromSharedRituals(campaign, userId) {
  const ids = sharedChallengeIds(campaign);
  if (ids.length === 0) return;
  const participantId = toObjectId(userId);
  await Challenge.updateMany(
    { _id: { $in: ids }, 'participants.userId': participantId },
    { $pull: { participants: { userId: participantId } } }
  );
}

async function refreshPersonalSnapshots(campaign) {
  const templates = personalTemplates(campaign);
  for (const template of templates) {
    const sourceId = idOf(template?.challengeId);
    if (!sourceId) continue;
    const source = await Challenge.findById(sourceId);
    if (!source) continue;
    const snapshot = snapshotPersonalTemplate(source);
    if (isSameChallenge(campaign.personalTemplate?.challengeId, sourceId)) {
      campaign.personalTemplate = snapshot;
      continue;
    }
    const extraIndex = extraPersonalIndexForChallenge(campaign, sourceId);
    if (extraIndex >= 0) {
      campaign.extraPersonalTemplates.set(extraIndex, snapshot);
      campaign.markModified('extraPersonalTemplates');
    }
  }
}

async function clearCampaignInviteNotifications(campaignId, userId) {
  await Notification.deleteMany({
    type: 'campaign_invite',
    campaignId,
    userId
  });
}

async function publish(campaignId, ownerId, joinDate) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);
  if (!hasBothSlots(campaign)) throw serviceError('slots_incomplete', 400);

  await refreshPersonalSnapshots(campaign);
  if (!hasPersonalTemplate(campaign)) throw serviceError('slots_incomplete', 400);
  if (!(campaign.invites || []).some((row) => idOf(row.userId))) {
    throw serviceError('invites_required', 400);
  }

  if (shouldClonePersonal(campaign, ownerId)) {
    await clonePersonalQuest(campaign, ownerId, joinDate);
  }

  campaign.status = resolveCampaignStatus({ ...campaign.toObject(), status: 'open' }, joinDate || new Date());
  await campaign.save();

  const invitees = (campaign.invites || []).map((row) => idOf(row.userId)).filter(Boolean);
  await Promise.all(
    invitees.map((userId) => notifyCampaignInvite({
      recipientId: userId,
      fromUserId: ownerId,
      campaign
    }))
  );

  return presentCampaign(campaign._id);
}

async function acceptInvite(campaignId, userId, joinDate) {
  const campaign = await loadCampaign(campaignId);
  if (!isCampaignInvitee(campaign, userId)) throw serviceError('invite_not_found', 404);
  if (campaign.status === 'draft') throw serviceError('not_published', 400);

  const alreadyMember = isCampaignMember(campaign, userId);
  campaign.invites = campaign.invites.filter((row) => idOf(row.userId) !== String(userId));

  if (!alreadyMember) {
    campaign.members.push({
      userId: toObjectId(userId),
      joinedAt: joinDate || new Date()
    });
  }

  await joinSharedRitual(campaign, userId, joinDate);
  if (shouldClonePersonal(campaign, userId)) {
    await clonePersonalQuest(campaign, userId, joinDate);
  }

  await campaign.save();
  await clearCampaignInviteNotifications(campaign._id, userId);
  return presentCampaign(campaign._id);
}

async function rejectInvite(campaignId, userId) {
  const campaign = await loadCampaign(campaignId);
  if (!isCampaignInvitee(campaign, userId)) throw serviceError('invite_not_found', 404);

  campaign.invites = campaign.invites.filter((row) => idOf(row.userId) !== String(userId));
  await campaign.save();
  await clearCampaignInviteNotifications(campaign._id, userId);
  return { status: 'none' };
}

async function leaveCampaign(campaignId, userId) {
  const campaign = await loadCampaign(campaignId);
  if (isCampaignOwner(campaign, userId)) throw serviceError('owner_cannot_leave', 400);
  if (!isCampaignMember(campaign, userId)) throw serviceError('not_a_member', 400);

  campaign.members = campaign.members.filter((row) => idOf(row.userId) !== String(userId));
  await campaign.save();

  await pullFromSharedRituals(campaign, userId);

  return presentCampaign(campaign._id);
}

async function kickCampaignMember(campaignId, ownerId, targetUserId) {
  const campaign = await loadCampaign(campaignId);
  if (!isCampaignOwner(campaign, ownerId)) throw serviceError('forbidden', 403);
  if (campaign.status === 'draft') throw serviceError('not_published', 400);
  if (!isValidUserId(targetUserId)) throw serviceError('invalid_user', 400);
  if (isCampaignOwner(campaign, targetUserId)) throw serviceError('owner_cannot_leave', 400);
  if (!isCampaignMember(campaign, targetUserId)) throw serviceError('not_a_member', 400);

  campaign.members = campaign.members.filter((row) => idOf(row.userId) !== String(targetUserId));
  await campaign.save();

  await pullFromSharedRituals(campaign, targetUserId);

  return presentCampaign(campaign._id);
}

async function listForUser(userId) {
  const campaigns = await Campaign.find({
    $or: [
      { owner: userId },
      { 'members.userId': userId },
      { 'invites.userId': userId }
    ]
  })
    .populate('owner', 'name avatarUrl')
    .populate('members.userId', 'name avatarUrl')
    .populate('invites.userId', 'name avatarUrl')
    .populate('sharedChallengeId', 'title challengeType startDate endDate inviteOnly privacy campaignRole')
    .populate('extraSharedChallengeIds', 'title challengeType startDate endDate inviteOnly privacy campaignRole')
    .populate('personalClones.challengeId', 'title challengeType startDate endDate campaignRole')
    .sort({ createdAt: -1 });

  return campaigns
    .map((campaign) => withLiveStatus(campaign))
    .filter((campaign) => campaign.status !== 'draft' || isCampaignOwner(campaign, userId));
}

async function assertQuestStructureEditable(challenge) {
  const role = challenge?.campaignRole;
  if (role === CAMPAIGN_ROLES.PERSONAL_CLONE) {
    throw serviceError('structure_locked', 403);
  }
  if (role !== CAMPAIGN_ROLES.PERSONAL_TEMPLATE) return;
  if (!challenge.campaignId) throw serviceError('structure_locked', 403);
  const campaign = await Campaign.findById(challenge.campaignId).select('status');
  if (!campaign || campaign.status !== 'draft') {
    throw serviceError('structure_locked', 403);
  }
}

async function findPersonalTemplateChallengeId(campaignId) {
  const campaign = await Campaign.findById(campaignId)
    .select('personalTemplate.challengeId extraPersonalTemplates.challengeId')
    .lean();
  const primaryId = idOf(campaign?.personalTemplate?.challengeId);
  if (primaryId) return primaryId;

  const extraIds = (campaign?.extraPersonalTemplates || [])
    .map((template) => idOf(template.challengeId))
    .filter(Boolean);
  const template = await Challenge.findOne({
    campaignId,
    campaignRole: CAMPAIGN_ROLES.PERSONAL_TEMPLATE,
    ...(extraIds.length ? { _id: { $nin: extraIds } } : {})
  }).select('_id').lean();
  return template?._id ? String(template._id) : '';
}

async function constrainSlotChallengeUpdate(challenge, update = {}) {
  if (!challenge?.campaignId) return update;
  const campaign = await Campaign.findById(challenge.campaignId).select('startDate endDate');
  if (!campaign) return update;
  return {
    ...update,
    startDate: campaign.startDate,
    endDate: campaign.endDate
  };
}

async function syncDraftSlotAfterChallengeSave(challenge) {
  if (!challenge?.campaignId || challenge.campaignRole !== CAMPAIGN_ROLES.PERSONAL_TEMPLATE) return;
  const campaign = await Campaign.findById(challenge.campaignId);
  if (!campaign || campaign.status !== 'draft') return;
  const snapshot = snapshotPersonalTemplate(challenge);
  if (
    !hasPersonalTemplate(campaign)
    || isSameChallenge(campaign.personalTemplate?.challengeId, challenge._id)
  ) {
    campaign.personalTemplate = snapshot;
  } else {
    const extraIndex = extraPersonalIndexForChallenge(campaign, challenge._id);
    if (extraIndex < 0) return;
    campaign.extraPersonalTemplates.set(extraIndex, snapshot);
    campaign.markModified('extraPersonalTemplates');
  }
  await campaign.save();
}

async function detachDraftSlotOnChallengeDelete(challenge) {
  if (!challenge?.campaignId) return;
  const campaign = await Campaign.findById(challenge.campaignId);
  if (!campaign || campaign.status !== 'draft') return;

  if (challenge.campaignRole === CAMPAIGN_ROLES.SHARED) {
    if (isSameChallenge(campaign.sharedChallengeId, challenge._id)) {
      campaign.sharedChallengeId = null;
      await campaign.save();
      return;
    }
    const extraIds = extraSharedIds(campaign);
    if (!extraIds.includes(String(challenge._id))) return;
    campaign.extraSharedChallengeIds = (campaign.extraSharedChallengeIds || [])
      .filter((value) => !isSameChallenge(value, challenge._id));
    await campaign.save();
    return;
  }

  if (challenge.campaignRole === CAMPAIGN_ROLES.PERSONAL_TEMPLATE) {
    if (isSameChallenge(campaign.personalTemplate?.challengeId, challenge._id)) {
      campaign.personalTemplate = emptyPersonalTemplate();
      await campaign.save();
      return;
    }
    const extraIndex = extraPersonalIndexForChallenge(campaign, challenge._id);
    if (extraIndex < 0) return;
    campaign.extraPersonalTemplates.splice(extraIndex, 1);
    await campaign.save();
  }
}

async function getById(campaignId, userId) {
  const campaign = await loadCampaign(campaignId);
  if (!canViewCampaign(campaign, userId)) throw serviceError('campaign_not_found', 404);
  if (campaign.status === 'draft' && !isCampaignOwner(campaign, userId)) {
    throw serviceError('campaign_not_found', 404);
  }
  return presentCampaign(campaign._id);
}

module.exports = {
  createDraft,
  updateDraft,
  deleteDraft,
  prepareCreatedChallenge,
  finalizeCreatedChallenge,
  attachSharedSlot,
  attachPersonalSlot,
  publish,
  acceptInvite,
  rejectInvite,
  leaveCampaign,
  kickCampaignMember,
  listForUser,
  getById,
  withLiveStatus,
  constrainSlotChallengeUpdate,
  syncDraftSlotAfterChallengeSave,
  detachDraftSlotOnChallengeDelete,
  assertQuestStructureEditable,
  applyCheckedOntoActions,
  ownerIdOf
};
