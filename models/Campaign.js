const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    description: {
      type: String,
      default: '',
      trim: true
    },
    imageUrl: {
      type: String,
      default: ''
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['draft', 'open', 'active', 'finished'],
      default: 'draft'
    },
    members: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        joinedAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    invites: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        invitedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    sharedChallengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Challenge',
      default: null
    },
    personalTemplate: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      imageUrl: { type: String, default: '' },
      actions: { type: Array, default: [] },
      reward: { type: String, default: '' },
      difficulty: {
        type: String,
        enum: ['easy', 'medium', 'heroic'],
        default: 'medium'
      }
    },
    personalClones: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        challengeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Challenge',
          required: true
        }
      }
    ]
  },
  {
    timestamps: { createdAt: true, updatedAt: true }
  }
);

campaignSchema.index({ owner: 1, status: 1, createdAt: -1 });
campaignSchema.index({ 'members.userId': 1 });
campaignSchema.index({ 'invites.userId': 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
