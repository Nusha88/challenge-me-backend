const express = require('express')
const Visit = require('../models/Visit')
const { visitRateLimiter } = require('../middleware/registerRateLimiter')
const { recordVisit } = require('../utils/visitService')

const router = express.Router()

router.post('/', visitRateLimiter, async (req, res) => {
  try {
    await recordVisit(Visit, req.body || {}, req)
    res.status(204).end()
  } catch (error) {
    const status = error.status || 500
    if (status >= 500) {
      console.error('Visit beacon error:', error)
    }
    res.status(status).json({
      message: error.message || 'Error recording visit'
    })
  }
})

module.exports = router
