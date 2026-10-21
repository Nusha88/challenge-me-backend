const crypto = require('crypto');
const User = require('../models/User');
const { spendSparksOnce } = require('./sparksService');
const { serializeInventory } = require('./userSerializer');
const {
  SHOP_DEFENSE_CATALOG,
  WISH_LIMITS,
  getDefenseCatalogItem,
  buildShopWishSpendKey,
  buildShopTokenSpendKey
} = require('../constants/shopRules');

function createShopNonce() {
  return crypto.randomBytes(12).toString('hex');
}

function serializeWishItem(item) {
  if (!item) return null;

  return {
    id: String(item._id),
    title: item.title,
    cost: item.cost
  };
}

function serializeDefenseCatalog() {
  return SHOP_DEFENSE_CATALOG.map(({ type, cost }) => ({ type, cost }));
}

function parseWishTitle(value) {
  if (typeof value !== 'string') return { error: 'invalid_title' };
  const title = value.trim();
  if (!title) return { error: 'invalid_title' };
  if (title.length > WISH_LIMITS.TITLE_MAX_LENGTH) return { error: 'title_too_long' };
  return { title };
}

function parseWishCost(value) {
  const cost = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(cost) || cost < WISH_LIMITS.COST_MIN || cost > WISH_LIMITS.COST_MAX) {
    return { error: 'invalid_cost' };
  }
  return { cost };
}

async function getShopState(userId) {
  const user = await User.findById(userId).select('sparks wishItems inventory');
  if (!user) return null;

  return {
    sparks: Math.max(0, Number(user.sparks) || 0),
    wishItems: (user.wishItems || []).map(serializeWishItem),
    inventory: serializeInventory(user) || { freezeTokens: 0, secondChanceTokens: 0 },
    catalog: serializeDefenseCatalog()
  };
}

async function createWish(userId, payload = {}) {
  const parsedTitle = parseWishTitle(payload.title);
  if (parsedTitle.error) return { success: false, reason: parsedTitle.error };

  const parsedCost = parseWishCost(payload.cost);
  if (parsedCost.error) return { success: false, reason: parsedCost.error };

  const user = await User.findById(userId).select('wishItems');
  if (!user) return { success: false, reason: 'user_not_found' };
  if ((user.wishItems || []).length >= WISH_LIMITS.MAX_ITEMS) {
    return { success: false, reason: 'wish_limit_reached' };
  }

  user.wishItems.push({
    title: parsedTitle.title,
    cost: parsedCost.cost
  });
  await user.save();

  const created = user.wishItems[user.wishItems.length - 1];
  return {
    success: true,
    wish: serializeWishItem(created),
    wishItems: user.wishItems.map(serializeWishItem)
  };
}

async function updateWish(userId, wishId, payload = {}) {
  const user = await User.findById(userId).select('wishItems');
  if (!user) return { success: false, reason: 'user_not_found' };

  const wish = user.wishItems.id(wishId);
  if (!wish) return { success: false, reason: 'wish_not_found' };

  if (payload.title !== undefined) {
    const parsedTitle = parseWishTitle(payload.title);
    if (parsedTitle.error) return { success: false, reason: parsedTitle.error };
    wish.title = parsedTitle.title;
  }

  if (payload.cost !== undefined) {
    const parsedCost = parseWishCost(payload.cost);
    if (parsedCost.error) return { success: false, reason: parsedCost.error };
    wish.cost = parsedCost.cost;
  }

  await user.save();
  return {
    success: true,
    wish: serializeWishItem(wish),
    wishItems: user.wishItems.map(serializeWishItem)
  };
}

async function deleteWish(userId, wishId) {
  const user = await User.findById(userId).select('wishItems');
  if (!user) return { success: false, reason: 'user_not_found' };

  const wish = user.wishItems.id(wishId);
  if (!wish) return { success: false, reason: 'wish_not_found' };

  wish.deleteOne();
  await user.save();

  return {
    success: true,
    wishItems: user.wishItems.map(serializeWishItem)
  };
}

async function redeemWish(userId, wishId) {
  const user = await User.findById(userId).select('wishItems');
  if (!user) return { success: false, reason: 'user_not_found' };

  const wish = user.wishItems.id(wishId);
  if (!wish) return { success: false, reason: 'wish_not_found' };

  const spendResult = await spendSparksOnce(
    userId,
    buildShopWishSpendKey(String(wish._id), createShopNonce()),
    wish.cost,
    { wishId: String(wish._id), title: wish.title }
  );

  return {
    ...spendResult,
    wish: serializeWishItem(wish)
  };
}

async function buyDefenseToken(userId, type) {
  const item = getDefenseCatalogItem(type);
  if (!item) return { success: false, reason: 'invalid_type' };

  const eventKey = buildShopTokenSpendKey(type, createShopNonce());
  const inventoryPath = `inventory.${item.inventoryField}`;

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      sparks: { $gte: item.cost },
      awardedSparksEventKeys: { $ne: eventKey }
    },
    {
      $inc: { sparks: -item.cost, [inventoryPath]: 1 },
      $addToSet: { awardedSparksEventKeys: eventKey }
    },
    { new: true }
  );

  if (!updatedUser) {
    const existing = await User.findById(userId).select('_id sparks');
    if (!existing) return { success: false, reason: 'user_not_found' };
    return { success: false, reason: 'insufficient_sparks' };
  }

  return {
    success: true,
    sparksSpent: item.cost,
    type,
    user: updatedUser,
    inventory: serializeInventory(updatedUser)
  };
}

async function consumeInventoryTokenOrSpendSparks(userId, {
  tokenField,
  spendKey,
  sparkCost,
  meta = {}
} = {}) {
  const tokenUser = await User.findOneAndUpdate(
    {
      _id: userId,
      [tokenField]: { $gte: 1 },
      awardedSparksEventKeys: { $ne: spendKey }
    },
    {
      $inc: { [tokenField]: -1 },
      $addToSet: { awardedSparksEventKeys: spendKey }
    },
    { new: true }
  );

  if (tokenUser) {
    return {
      success: true,
      paidWith: 'token',
      sparksSpent: 0,
      eventKey: spendKey,
      user: tokenUser,
      meta
    };
  }

  const spendResult = await spendSparksOnce(userId, spendKey, sparkCost, meta);
  return {
    ...spendResult,
    paidWith: spendResult.success ? 'sparks' : undefined
  };
}

module.exports = {
  serializeWishItem,
  serializeDefenseCatalog,
  parseWishTitle,
  parseWishCost,
  getShopState,
  createWish,
  updateWish,
  deleteWish,
  redeemWish,
  buyDefenseToken,
  consumeInventoryTokenOrSpendSparks
};
