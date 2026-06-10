const mongoose = require('mongoose');

const dailyChecklistTaskSchema = new mongoose.Schema({
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
}, { _id: false });

const dailyChecklistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  localDate: {
    type: String,
    required: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, 'localDate must be YYYY-MM-DD']
  },
  timeZone: {
    type: String,
    default: 'UTC'
  },
  date: {
    type: Date,
    required: true
  },
  tasks: {
    type: [dailyChecklistTaskSchema],
    default: []
  }
});

dailyChecklistSchema.index({ userId: 1, localDate: 1 }, { unique: true });
dailyChecklistSchema.index({ userId: 1, localDate: -1 });

const DailyChecklist = mongoose.models.DailyChecklist
  || mongoose.model('DailyChecklist', dailyChecklistSchema);

module.exports = DailyChecklist;
