const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['mention', 'comment', 'join', 'watch', 'daily_recap'],
      required: true
    },
    title: {
      type: String,
      default: null,
      trim: true
    },
    body: {
      type: String,
      default: null,
      trim: true
    },
    localDate: {
      type: String,
      default: null,
      trim: true
    },
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Challenge',
      required: function requiredChallengeId() {
        return this.type !== 'daily_recap';
      },
      default: null
    },
    commentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    replyId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function requiredFromUserId() {
        return this.type !== 'daily_recap';
      },
      default: null
    },
    read: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

notificationSchema.index({ createdAt: -1 });

// Index for efficient queries
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

