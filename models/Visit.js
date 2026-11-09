const mongoose = require('mongoose')

const visitEventSchema = new mongoose.Schema({
  type: { type: String, required: true },
  path: { type: String, default: '/' },
  at: { type: Date, default: Date.now },
  meta: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { _id: false })

const visitSchema = new mongoose.Schema({
  visitorId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  firstSeenAt: { type: Date, default: Date.now, index: true },
  lastSeenAt: { type: Date, default: Date.now, index: true },
  pageviews: { type: Number, default: 1 },
  landedPath: { type: String, default: '/' },
  lastPath: { type: String, default: '/' },
  referrer: { type: String, default: '' },
  referrerHost: { type: String, default: '' },
  utmSource: { type: String, default: '' },
  utmMedium: { type: String, default: '' },
  utmCampaign: { type: String, default: '' },
  locale: { type: String, default: '' },
  language: { type: String, default: '' },
  countryCode: { type: String, default: '' },
  country: { type: String, default: '' },
  city: { type: String, default: '' },
  timezone: { type: String, default: '' },
  device: {
    type: String,
    enum: ['mobile', 'tablet', 'desktop', 'unknown'],
    default: 'unknown'
  },
  viewportW: { type: Number, default: 0 },
  viewportH: { type: Number, default: 0 },
  userAgent: { type: String, default: '' },
  convertedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  convertedAt: { type: Date, default: null },
  events: { type: [visitEventSchema], default: [] }
})

visitSchema.index({ convertedUserId: 1, lastSeenAt: -1 })

module.exports = mongoose.model('Visit', visitSchema)
