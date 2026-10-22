const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema(
  {
    userA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    userB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'accepted'],
      default: 'pending',
      required: true
    }
  },
  { timestamps: true }
);

friendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });
friendshipSchema.index({ userA: 1, status: 1 });
friendshipSchema.index({ userB: 1, status: 1 });
friendshipSchema.index({ requesterId: 1, status: 1 });

module.exports = mongoose.models.Friendship || mongoose.model('Friendship', friendshipSchema);
