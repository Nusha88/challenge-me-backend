const mongoose = require('mongoose');

// Check if the model already exists to prevent model overwrite error
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
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
      }
    }]
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
}));

module.exports = User; 