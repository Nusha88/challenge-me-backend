const mongoose = require('mongoose');

// Check if the model already exists to prevent model overwrite error
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  age: {
    type: Number,
    required: true,
    min: 0,
    max: 120
  },
  country: {
    type: String,
    required: true,
    trim: true
  },
  plan: {
    type: String,
    required: true,
    enum: ['Energy', 'Present', 'Future'],
    default: 'Energy'
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}));

module.exports = User; 