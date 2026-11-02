const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const { getClientDayRange } = require('../utils/dateHelpers');
const {
  createDraft,
  updateDraft,
  deleteDraft,
  attachSharedSlot,
  attachPersonalSlot,
  publish,
  acceptInvite,
  rejectInvite,
  leaveCampaign,
  listForUser,
  getById
} = require('../utils/campaignService');

const ERROR_MESSAGES = {
  title_required: 'Title is required',
  dates_required: 'Start and end dates are required',
  invalid_duration: 'A challenge must last between 7 and 21 days',
  campaign_limit: 'You already have an active challenge',
  campaign_not_found: 'Challenge not found',
  invalid_campaign: 'Invalid challenge',
  forbidden: 'Forbidden',
  not_draft: 'Only a draft can be edited',
  invalid_slot: 'This slot is not available',
  dates_outside_campaign: 'Mission dates must stay inside the challenge',
  shared_taken: 'The shared ritual is already set',
  personal_taken: 'The personal quest is already set',
  not_a_ritual: 'The shared slot must be a ritual',
  not_a_quest: 'The personal slot must be a quest',
  invalid_challenge: 'Invalid mission',
  challenge_not_found: 'Mission not found',
  personal_incomplete: 'The personal quest is incomplete',
  slots_incomplete: 'Add a shared ritual and a personal quest first',
  invites_required: 'Invite at least one friend',
  invite_not_found: 'Invite not found',
  not_published: 'This challenge is not open yet',
  owner_cannot_leave: 'The organizer cannot leave the challenge',
  not_a_member: 'You are not in this challenge',
  shared_missing: 'The shared ritual is missing'
};

function sendCampaignError(res, error) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error('Campaign error:', error);
  }
  return res.status(status).json({
    message: ERROR_MESSAGES[error.reason] || 'Unable to update challenge',
    reason: error.reason || 'unknown'
  });
}

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const campaigns = await listForUser(req.user.id);
    res.json({ campaigns });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    const campaign = await createDraft(req.user.id, req.body || {});
    res.status(201).json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const campaign = await getById(req.params.id, req.user.id);
    res.json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const campaign = await updateDraft(req.params.id, req.user.id, req.body || {});
    res.json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteDraft(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.post('/:id/slots/shared', async (req, res) => {
  try {
    const campaign = await attachSharedSlot(req.params.id, req.user.id, req.body?.challengeId);
    res.json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.post('/:id/slots/personal', async (req, res) => {
  try {
    const campaign = await attachPersonalSlot(req.params.id, req.user.id, req.body || {});
    res.json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.post('/:id/publish', async (req, res) => {
  try {
    const { startUtc } = getClientDayRange(req, 0);
    const campaign = await publish(req.params.id, req.user.id, startUtc);
    res.json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.post('/:id/invites/accept', async (req, res) => {
  try {
    const { startUtc } = getClientDayRange(req, 0);
    const campaign = await acceptInvite(req.params.id, req.user.id, startUtc);
    res.json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.post('/:id/invites/reject', async (req, res) => {
  try {
    const result = await rejectInvite(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    sendCampaignError(res, error);
  }
});

router.post('/:id/leave', async (req, res) => {
  try {
    const campaign = await leaveCampaign(req.params.id, req.user.id);
    res.json({ campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

module.exports = router;
