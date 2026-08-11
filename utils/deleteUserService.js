const mongoose = require('mongoose');
const User = require('../models/User');
const Challenge = require('../models/Challenge');
const Notification = require('../models/Notification');
const Referral = require('../models/Referral');
const DailyChecklist = require('../models/DailyChecklist');
const { isSuperAdminUserId } = require('../constants/superAdmin');

async function deleteUserFromSystem(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user id');
    error.status = 400;
    throw error;
  }

  if (isSuperAdminUserId(userId)) {
    const error = new Error('Cannot delete the super admin');
    error.status = 400;
    throw error;
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const user = await User.findById(userObjectId).select('_id');
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const ownedChallengeIds = await Challenge.find({ owner: userObjectId }).distinct('_id');

  if (ownedChallengeIds.length > 0) {
    await Challenge.deleteMany({ _id: { $in: ownedChallengeIds } });
    await User.updateMany(
      { watchedChallenges: { $in: ownedChallengeIds } },
      { $pull: { watchedChallenges: { $in: ownedChallengeIds } } }
    );
  }

  await Challenge.updateMany(
    { 'participants.userId': userObjectId },
    { $pull: { participants: { userId: userObjectId } } }
  );

  await Challenge.updateMany(
    {},
    {
      $pull: {
        likedBy: userObjectId,
        dislikedBy: userObjectId,
        comments: { userId: userObjectId }
      }
    }
  );

  await User.updateMany(
    { referredBy: userObjectId },
    { $set: { referredBy: null } }
  );

  await Notification.deleteMany({ userId: userObjectId });
  await Referral.deleteMany({
    $or: [{ referrerId: userObjectId }, { refereeId: userObjectId }]
  });
  await DailyChecklist.deleteMany({ userId: userObjectId });

  await User.findByIdAndDelete(userObjectId);

  return { id: String(userObjectId) };
}

module.exports = {
  deleteUserFromSystem
};
