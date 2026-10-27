const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const { listChronicle, cheerActivity } = require('../utils/chronicleService');
const { notifyCheer } = require('../utils/notificationService');

const ERROR_MESSAGES = {
  invalid_user: 'Invalid user',
  invalid_activity: 'Invalid activity',
  activity_not_found: 'Activity not found',
  cannot_cheer_self: 'You cannot ignite your own chronicle'
};

function sendChronicleError(res, error) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error('Chronicle error:', error);
  }
  return res.status(status).json({
    message: ERROR_MESSAGES[error.reason] || 'Unable to load chronicle',
    reason: error.reason || 'unknown'
  });
}

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const payload = await listChronicle(req.user.id, {
      cursor: req.query.cursor,
      limit: req.query.limit
    });
    res.json(payload);
  } catch (error) {
    sendChronicleError(res, error);
  }
});

router.post('/:id/cheer', async (req, res) => {
  try {
    const result = await cheerActivity(req.params.id, req.user.id);
    if (result.created) {
      notifyCheer({
        recipientId: result.actorId,
        fromUserId: req.user.id,
        challengeId: result.challengeId,
        activityId: result.activity?._id
      }).catch((error) => {
        console.error('Chronicle cheer notify failed:', error);
      });
    }
    res.json(result.activity);
  } catch (error) {
    sendChronicleError(res, error);
  }
});

module.exports = router;
