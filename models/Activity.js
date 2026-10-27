const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['checkin', 'ritual_complete', 'squad_joined', 'level_up', 'streak_milestone'],
      required: true
    },
    audience: {
      type: String,
      enum: ['public', 'squad'],
      required: true
    },
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Challenge',
      default: null
    },
    localDate: {
      type: String,
      default: null,
      trim: true
    },
    payload: {
      title: { type: String, default: null, trim: true },
      level: { type: Number, default: null },
      streak: { type: Number, default: null }
    },
    cheersCount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

activitySchema.index({ createdAt: -1, _id: -1 });
activitySchema.index({ actorId: 1, createdAt: -1 });
activitySchema.index({ challengeId: 1, createdAt: -1 });
activitySchema.index(
  { actorId: 1, type: 1, challengeId: 1, localDate: 1 },
  { unique: true, partialFilterExpression: { type: 'checkin' } }
);
activitySchema.index(
  { actorId: 1, type: 1, 'payload.level': 1 },
  { unique: true, partialFilterExpression: { type: 'level_up' } }
);
activitySchema.index(
  { actorId: 1, type: 1, 'payload.streak': 1 },
  { unique: true, partialFilterExpression: { type: 'streak_milestone' } }
);
activitySchema.index(
  { actorId: 1, type: 1, challengeId: 1 },
  {
    unique: true,
    partialFilterExpression: { type: { $in: ['ritual_complete', 'squad_joined'] } }
  }
);

module.exports = mongoose.model('Activity', activitySchema);
