const mongoose = require('mongoose');

const activityCheerSchema = new mongoose.Schema(
  {
    activityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Activity',
      required: true
    },
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

activityCheerSchema.index({ activityId: 1, fromUserId: 1 }, { unique: true });
activityCheerSchema.index({ fromUserId: 1 });

module.exports = mongoose.model('ActivityCheer', activityCheerSchema);
