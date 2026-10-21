const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authenticateToken = require('../middleware/authenticateToken');
const { serializeUserForClient } = require('../utils/userSerializer');
const { buildRewardPayload } = require('../utils/rewardResponse');
const {
  getShopState,
  createWish,
  updateWish,
  deleteWish,
  redeemWish,
  buyDefenseToken
} = require('../utils/shopService');

function sendShopError(res, reason) {
  switch (reason) {
    case 'user_not_found':
    case 'wish_not_found':
      return res.status(404).json({ message: 'Not found', reason });
    case 'insufficient_sparks':
      return res.status(402).json({ message: 'Insufficient sparks', reason });
    case 'already_spent':
      return res.status(409).json({ message: 'Already spent', reason });
    case 'wish_limit_reached':
      return res.status(400).json({ message: 'Wish limit reached', reason });
    default:
      return res.status(400).json({ message: 'Unable to complete shop action', reason });
  }
}

function isValidWishId(wishId) {
  return mongoose.Types.ObjectId.isValid(wishId);
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const shop = await getShopState(req.user.id);
    if (!shop) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(shop);
  } catch (error) {
    console.error('Error loading shop:', error);
    res.status(500).json({
      message: 'Error loading shop',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/wishes', authenticateToken, async (req, res) => {
  try {
    const result = await createWish(req.user.id, {
      title: req.body?.title,
      cost: req.body?.cost
    });

    if (!result.success) {
      return sendShopError(res, result.reason);
    }

    res.status(201).json({
      wish: result.wish,
      wishItems: result.wishItems
    });
  } catch (error) {
    console.error('Error creating wish:', error);
    res.status(500).json({
      message: 'Error creating wish',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.patch('/wishes/:id', authenticateToken, async (req, res) => {
  try {
    if (!isValidWishId(req.params.id)) {
      return sendShopError(res, 'wish_not_found');
    }

    const result = await updateWish(req.user.id, req.params.id, {
      title: req.body?.title,
      cost: req.body?.cost
    });

    if (!result.success) {
      return sendShopError(res, result.reason);
    }

    res.json({
      wish: result.wish,
      wishItems: result.wishItems
    });
  } catch (error) {
    console.error('Error updating wish:', error);
    res.status(500).json({
      message: 'Error updating wish',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.delete('/wishes/:id', authenticateToken, async (req, res) => {
  try {
    if (!isValidWishId(req.params.id)) {
      return sendShopError(res, 'wish_not_found');
    }

    const result = await deleteWish(req.user.id, req.params.id);
    if (!result.success) {
      return sendShopError(res, result.reason);
    }

    res.json({ wishItems: result.wishItems });
  } catch (error) {
    console.error('Error deleting wish:', error);
    res.status(500).json({
      message: 'Error deleting wish',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/wishes/:id/redeem', authenticateToken, async (req, res) => {
  try {
    if (!isValidWishId(req.params.id)) {
      return sendShopError(res, 'wish_not_found');
    }

    const result = await redeemWish(req.user.id, req.params.id);
    if (!result.success) {
      return sendShopError(res, result.reason);
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(result.user)
    });

    res.json({
      message: 'Wish redeemed',
      sparksSpent: result.sparksSpent,
      wish: result.wish,
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error redeeming wish:', error);
    res.status(500).json({
      message: 'Error redeeming wish',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/tokens', authenticateToken, async (req, res) => {
  try {
    const result = await buyDefenseToken(req.user.id, req.body?.type);
    if (!result.success) {
      return sendShopError(res, result.reason);
    }

    const rewardPayload = buildRewardPayload({
      user: serializeUserForClient(result.user)
    });

    res.json({
      message: 'Token purchased',
      sparksSpent: result.sparksSpent,
      type: result.type,
      inventory: result.inventory,
      ...rewardPayload
    });
  } catch (error) {
    console.error('Error buying shop token:', error);
    res.status(500).json({
      message: 'Error buying shop token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
