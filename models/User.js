const mongoose = require('mongoose');

// Check if the model already exists to prevent model overwrite error
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  avatarUrl: {
    type: String,
    default: ''
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  watchedChallenges: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Challenge',
    default: []
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  dailyChecklists: [{
    date: {
      type: Date,
      required: true
    },
    tasks: [{
      title: {
        type: String,
        required: true
  },
      done: {
        type: Boolean,
        default: false
      },
      source: {
        kind: {
          type: String,
          enum: ['resultAction'],
          required: false
        },
        challengeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Challenge',
          required: false
        },
        actionId: {
          type: String,
          required: false
        }
      }
    }]
  }],
  xp: {
    type: Number,
    default: 0
  },
  awardedXpEventKeys: {
    type: [String],
    default: []
  },
  pushSubscription: {
    type: {
      endpoint: String,
      keys: {
        p256dh: String,
        auth: String
      }
    },
    default: null
  },
  dailyRecapEnabled: {
    type: Boolean,
    default: false
  },
  dailyRecapTime: {
    type: String,
    default: '20:00'
  },
  dailyRecapTimezone: {
    type: String,
    default: 'UTC'
  },
  dailyRecapLanguage: {
    type: String,
    enum: ['ru', 'en'],
    default: 'en'
  },
  dailyRecapLastSentLocalDate: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}));

module.exports = User; 
