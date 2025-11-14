const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    imageUrl: {
      type: String,
      default: ''
    },
    privacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public'
    },
    challengeType: {
      type: String,
      enum: ['habit', 'result'],
      default: 'habit'
    },
    frequency: {
      type: String,
      enum: ['daily', 'everyOtherDay', 'weekdays'],
      default: null
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
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Challenge', challengeSchema);
