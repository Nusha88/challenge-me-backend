const Campaign = require('../models/Campaign');
const Challenge = require('../models/Challenge');
const Friendship = require('../models/Friendship');
const Notification = require('../models/Notification');
const { notifyCampaignInvite, notifyChallengeJoin } = require('./notificationService');
const { recordSquadJoinedSafe } = require('./chronicleService');
const { sortedPair, toObjectId, isValidUserId, idOf } = require('./friendshipHelpers');
const {
  CAMPAIGN_ROLES,
  OWNED_BLOCKING_STATUSES,
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
  findPersonalClone,
  shouldClonePersonal,
  resolveCampaignStatus,
  cloneActionsUnchecked,
  snapshotPersonalTemplate,
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
    .populate('personalClones.challengeId', 'title challengeType startDate endDate campaignRole');
}

function withLiveStatus(campaign, today = new Date()) {
  if (!campaign) return campaign;
  const plain = typeof campaign.toObject === 'function' ? campaign.toObject() : { ...campaign };
  plain.status = resolveCampaignStatus(plain, today);
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
  return withLiveStatus(await populateCampaign(campaign._id));
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

  return withLiveStatus(await populateCampaign(campaign._id));
}

function assertDraftOwner(campaign, ownerId) {
  if (!isCampaignOwner(campaign, ownerId)) throw serviceError('forbidden', 403);
  if (campaign.status !== 'draft') throw serviceError('not_draft', 400);
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
    if (campaign.sharedChallengeId) throw serviceError('shared_taken', 409);
    if (fields.challengeType && fields.challengeType !== 'habit') {
      throw serviceError('not_a_ritual', 400);
    }
    return {
      campaign,
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

  if (hasPersonalTemplate(campaign)) throw serviceError('personal_taken', 409);
  if (fields.challengeType && fields.challengeType !== 'result') {
    throw serviceError('not_a_quest', 400);
  }
  return {
    campaign,
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

async function finalizeCreatedChallenge(campaignId, ownerId, challenge) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);

  if (challenge.campaignRole === CAMPAIGN_ROLES.SHARED) {
    if (campaign.sharedChallengeId && String(campaign.sharedChallengeId) !== String(challenge._id)) {
      throw serviceError('shared_taken', 409);
    }
    campaign.sharedChallengeId = challenge._id;
    await campaign.save();
    return withLiveStatus(await populateCampaign(campaign._id));
  }

  if (challenge.campaignRole === CAMPAIGN_ROLES.PERSONAL_TEMPLATE) {
    campaign.personalTemplate = snapshotPersonalTemplate(challenge);
    await campaign.save();
    return withLiveStatus(await populateCampaign(campaign._id));
  }

  throw serviceError('invalid_slot', 400);
}

async function attachSharedSlot(campaignId, ownerId, challengeId) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);
  if (campaign.sharedChallengeId) throw serviceError('shared_taken', 409);
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

  campaign.sharedChallengeId = challenge._id;
  await campaign.save();
  return withLiveStatus(await populateCampaign(campaign._id));
}

async function attachPersonalSlot(campaignId, ownerId, payload = {}) {
  const campaign = await loadCampaign(campaignId);
  assertDraftOwner(campaign, ownerId);
  if (hasPersonalTemplate(campaign)) throw serviceError('personal_taken', 409);

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
    campaign.personalTemplate = snapshotPersonalTemplate(challenge);
  } else {
    const snapshot = snapshotPersonalTemplate(payload);
    if (!snapshot.title || snapshot.actions.length === 0) {
      throw serviceError('personal_incomplete', 400);
    }
    campaign.personalTemplate = snapshot;
  }

  await campaign.save();
  return withLiveStatus(await populateCampaign(campaign._id));
}

async function clonePersonalQuest(campaign, userId, joinDate) {
  const existing = findPersonalClone(campaign, userId);
  if (existing) return existing.challengeId;

  let template = campaign.personalTemplate;
  const source = await Challenge.findOne({
    campaignId: campaign._id,
    campaignRole: CAMPAIGN_ROLES.PERSONAL_TEMPLATE
  });
  if (source) {
    template = snapshotPersonalTemplate(source);
    campaign.personalTemplate = template;
  }
  if (!template?.title || !Array.isArray(template.actions) || template.actions.length === 0) {
    throw serviceError('personal_incomplete', 400);
  }

  const cloned = new Challenge({
    title: template.title,
    description: template.description || '',
    imageUrl: template.imageUrl || '',
    privacy: 'private',
    inviteOnly: false,
    visibility: true,
    challengeType: 'result',
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    owner: userId,
    difficulty: template.difficulty || 'medium',
    reward: template.reward || '',
    actions: cloneActionsUnchecked(template.actions),
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
    challengeId: cloned._id
  });
  return cloned._id;
}

async function joinSharedRitual(campaign, userId, joinDate) {
  if (!campaign.sharedChallengeId) throw serviceError('shared_missing', 400);
  const updated = await Challenge.findOneAndUpdate(
    {
      _id: campaign.sharedChallengeId,
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

  const source = await Challenge.findOne({
    campaignId: campaign._id,
    campaignRole: CAMPAIGN_ROLES.PERSONAL_TEMPLATE
  });
  if (source) {
    campaign.personalTemplate = snapshotPersonalTemplate(source);
  }
  if (!hasPersonalTemplate(campaign)) throw serviceError('slots_incomplete', 400);

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

  return withLiveStatus(await populateCampaign(campaign._id));
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
  return withLiveStatus(await populateCampaign(campaign._id));
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

  if (campaign.sharedChallengeId) {
    await Challenge.updateOne(
      { _id: campaign.sharedChallengeId, 'participants.userId': userId },
      { $pull: { participants: { userId } } }
    );
  }

  return withLiveStatus(await populateCampaign(campaign._id));
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
    .populate('personalClones.challengeId', 'title challengeType startDate endDate campaignRole')
    .sort({ createdAt: -1 });

  return campaigns
    .map((campaign) => withLiveStatus(campaign))
    .filter((campaign) => campaign.status !== 'draft' || isCampaignOwner(campaign, userId));
}

async function getById(campaignId, userId) {
  const campaign = await loadCampaign(campaignId);
  if (!canViewCampaign(campaign, userId)) throw serviceError('campaign_not_found', 404);
  if (campaign.status === 'draft' && !isCampaignOwner(campaign, userId)) {
    throw serviceError('campaign_not_found', 404);
  }
  return withLiveStatus(await populateCampaign(campaign._id));
}

module.exports = {
  createDraft,
  updateDraft,
  prepareCreatedChallenge,
  finalizeCreatedChallenge,
  attachSharedSlot,
  attachPersonalSlot,
  publish,
  acceptInvite,
  rejectInvite,
  leaveCampaign,
  listForUser,
  getById,
  withLiveStatus,
  ownerIdOf
};
