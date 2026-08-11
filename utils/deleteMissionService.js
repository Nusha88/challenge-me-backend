const mongoose = require('mongoose');
const Challenge = require('../models/Challenge');
const User = require('../models/User');
const Notification = require('../models/Notification');

async function deleteMissionFromSystem(missionId) {
  if (!mongoose.Types.ObjectId.isValid(missionId)) {
    const error = new Error('Invalid mission id');
    error.status = 400;
    throw error;
  }

  const challengeObjectId = new mongoose.Types.ObjectId(missionId);
  const challenge = await Challenge.findById(challengeObjectId).select('_id');
  if (!challenge) {
    const error = new Error('Mission not found');
    error.status = 404;
    throw error;
  }

  await Challenge.findByIdAndDelete(challengeObjectId);

  await User.updateMany(
    { watchedChallenges: challengeObjectId },
    { $pull: { watchedChallenges: challengeObjectId } }
  );

  await Notification.deleteMany({ challengeId: challengeObjectId });

  return { id: String(challengeObjectId) };
}

module.exports = {
  deleteMissionFromSystem
};
