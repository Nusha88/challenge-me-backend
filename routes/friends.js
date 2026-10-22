const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const {
  sendRequest,
  acceptRequest,
  rejectRequest,
  listFriends,
  listIncoming,
  countIncoming,
  getStatus,
  getStatuses
} = require('../utils/friendshipService');

const ERROR_MESSAGES = {
  cannot_friend_self: 'You cannot add yourself to the squad',
  invalid_user: 'Invalid user',
  user_not_found: 'User not found',
  friendship_not_found: 'Request not found',
  forbidden: 'Forbidden',
  cannot_accept_own_request: 'You cannot accept your own request',
  invalid_status: 'This request cannot be updated',
  invalid_friendship: 'Invalid request'
};

function sendFriendError(res, error) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error('Friends error:', error);
  }
  return res.status(status).json({
    message: ERROR_MESSAGES[error.reason] || 'Unable to update squad',
    reason: error.reason || 'unknown'
  });
}

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const payload = await listFriends(req.user.id);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

router.get('/incoming', async (req, res) => {
  try {
    const payload = await listIncoming(req.user.id);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

router.get('/incoming-count', async (req, res) => {
  try {
    const payload = await countIncoming(req.user.id);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

router.get('/statuses', async (req, res) => {
  try {
    const payload = await getStatuses(req.user.id, req.query.ids);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

router.get('/status/:userId', async (req, res) => {
  try {
    const payload = await getStatus(req.user.id, req.params.userId);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

router.post('/request', async (req, res) => {
  try {
    const payload = await sendRequest(req.user.id, req.body?.userId);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

router.post('/:id/accept', async (req, res) => {
  try {
    const payload = await acceptRequest(req.user.id, req.params.id);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const payload = await rejectRequest(req.user.id, req.params.id);
    res.json(payload);
  } catch (error) {
    sendFriendError(res, error);
  }
});

module.exports = router;
