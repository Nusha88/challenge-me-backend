const mongoose = require('mongoose')
const {
  clip,
  isValidVisitorId,
  sanitizePath,
  referrerHost,
  parseDevice,
  parseUtm,
  parseEvent,
  isSamePageviewDebounce,
  MAX_EVENTS,
  MAX_REFERRER,
  MAX_UA
} = require('./visitHelpers')
const { parseAdminPage, startOfToday } = require('./adminPage')
const { lookupGeoFromRequest } = require('./geoLookup')

function daysAgo(days, from = startOfToday()) {
  const date = new Date(from)
  date.setDate(date.getDate() - days)
  return date
}

function payloadEventAllowsConversion(event) {
  return event === 'register_success' || event === 'login_success'
}

function compactMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const out = {}
  for (const [key, value] of Object.entries(meta)) {
    if (out && Object.keys(out).length >= 6) break
    const safeKey = clip(key, 40)
    if (!safeKey) continue
    if (typeof value === 'string') out[safeKey] = clip(value, 80)
    else if (typeof value === 'number' && Number.isFinite(value)) out[safeKey] = value
    else if (typeof value === 'boolean') out[safeKey] = value
  }
  return Object.keys(out).length ? out : undefined
}

function appendEvent(events, entry) {
  const next = [...(events || []), entry]
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
}

function hasEventType(events, type) {
  return (events || []).some((item) => item.type === type)
}

function parseVisitPayload(body = {}, req = {}) {
  const visitorId = String(body.visitorId || '').trim()
  if (!isValidVisitorId(visitorId)) {
    const error = new Error('Invalid visitorId')
    error.status = 400
    throw error
  }

  const event = parseEvent(body.event)
  const path = sanitizePath(body.path)
  const referrer = clip(body.referrer, MAX_REFERRER)
  const utm = parseUtm(body)
  const locale = clip(body.locale, 12)
  const language = clip(body.language || req.headers?.['accept-language'], 40)
  const userAgent = clip(body.userAgent || req.headers?.['user-agent'], MAX_UA)
  const viewportW = Number(body.viewportW)
  const viewportH = Number(body.viewportH)
  const canAttachUser = payloadEventAllowsConversion(event)
    && mongoose.Types.ObjectId.isValid(body.userId)
  const convertedUserId = canAttachUser ? String(body.userId) : null
  const timezone = clip(body.timezone, 80)
  const geo = lookupGeoFromRequest(req)

  return {
    visitorId,
    event,
    path,
    referrer,
    referrerHost: referrerHost(referrer),
    ...utm,
    locale,
    language,
    timezone: timezone || geo?.timezone || '',
    countryCode: geo?.countryCode || '',
    country: geo?.country || '',
    city: geo?.city || '',
    device: parseDevice(userAgent),
    viewportW: Number.isFinite(viewportW) ? Math.max(0, Math.min(viewportW, 8000)) : 0,
    viewportH: Number.isFinite(viewportH) ? Math.max(0, Math.min(viewportH, 8000)) : 0,
    userAgent,
    convertedUserId,
    meta: compactMeta(body.meta)
  }
}

function fillGeo(visit, payload) {
  if (payload.timezone && !visit.timezone) visit.timezone = payload.timezone
  if (visit.countryCode) return
  if (payload.countryCode) {
    visit.countryCode = payload.countryCode
    visit.country = payload.country || ''
    visit.city = payload.city || ''
    if (!visit.timezone && payload.timezone) visit.timezone = payload.timezone
  }
}

async function recordVisit(Visit, rawBody, req, retryOnDuplicate = true) {
  const payload = parseVisitPayload(rawBody, req)
  const now = new Date()
  const visit = await Visit.findOne({ visitorId: payload.visitorId })
  const eventEntry = {
    type: payload.event,
    path: payload.path,
    at: now,
    meta: payload.meta
  }

  if (!visit) {
    try {
      const created = await Visit.create({
        visitorId: payload.visitorId,
        firstSeenAt: now,
        lastSeenAt: now,
        pageviews: payload.event === 'pageview' ? 1 : 0,
        landedPath: payload.path,
        lastPath: payload.path,
        referrer: payload.referrer,
        referrerHost: payload.referrerHost,
        utmSource: payload.utmSource,
        utmMedium: payload.utmMedium,
        utmCampaign: payload.utmCampaign,
        locale: payload.locale,
        language: payload.language,
        device: payload.device,
        viewportW: payload.viewportW,
        viewportH: payload.viewportH,
        userAgent: payload.userAgent,
        countryCode: payload.countryCode,
        country: payload.country,
        city: payload.city,
        timezone: payload.timezone,
        convertedUserId: payload.convertedUserId,
        convertedAt: payload.convertedUserId ? now : null,
        events: [eventEntry]
      })
      return created
    } catch (error) {
      if (error?.code !== 11000 || !retryOnDuplicate) throw error
      return recordVisit(Visit, rawBody, req, false)
    }
  }

  const skipPageview = payload.event === 'pageview'
    && isSamePageviewDebounce(visit, payload.path, now.getTime())
  const skipDuplicateOnce = payload.event !== 'pageview'
    && hasEventType(visit.events, payload.event)
    && ['landing_scroll_50', 'register_success', 'login_success'].includes(payload.event)

  if (skipPageview || skipDuplicateOnce) {
    visit.lastSeenAt = now
    if (!skipPageview) visit.lastPath = payload.path
    fillGeo(visit, payload)
    await visit.save()
    return visit
  }

  visit.lastSeenAt = now
  visit.lastPath = payload.path
  if (payload.event === 'pageview') visit.pageviews += 1
  if (!visit.referrer && payload.referrer) {
    visit.referrer = payload.referrer
    visit.referrerHost = payload.referrerHost
  }
  if (!visit.utmSource && payload.utmSource) {
    visit.utmSource = payload.utmSource
    visit.utmMedium = payload.utmMedium
    visit.utmCampaign = payload.utmCampaign
  }
  if (payload.locale) visit.locale = payload.locale
  if (payload.language) visit.language = payload.language
  if (payload.device && payload.device !== 'unknown') visit.device = payload.device
  if (payload.viewportW) visit.viewportW = payload.viewportW
  if (payload.viewportH) visit.viewportH = payload.viewportH
  if (payload.userAgent) visit.userAgent = payload.userAgent
  if (!visit.convertedUserId && payload.convertedUserId) {
    visit.convertedUserId = payload.convertedUserId
    visit.convertedAt = now
  }
  fillGeo(visit, payload)
  visit.events = appendEvent(visit.events, eventEntry)
  await visit.save()
  return visit
}

function serializeVisit(visit) {
  const events = visit.events || []
  const lastEvent = events[events.length - 1]
  return {
    id: String(visit._id),
    visitorId: visit.visitorId,
    firstSeenAt: visit.firstSeenAt,
    lastSeenAt: visit.lastSeenAt,
    pageviews: visit.pageviews || 0,
    landedPath: visit.landedPath || '/',
    lastPath: visit.lastPath || '/',
    referrer: visit.referrer || '',
    referrerHost: visit.referrerHost || '',
    utmSource: visit.utmSource || '',
    utmMedium: visit.utmMedium || '',
    utmCampaign: visit.utmCampaign || '',
    locale: visit.locale || '',
    language: visit.language || '',
    countryCode: visit.countryCode || '',
    country: visit.country || '',
    city: visit.city || '',
    timezone: visit.timezone || '',
    device: visit.device || 'unknown',
    viewportW: visit.viewportW || 0,
    viewportH: visit.viewportH || 0,
    converted: Boolean(visit.convertedUserId),
    convertedUserId: visit.convertedUserId ? String(visit.convertedUserId) : null,
    convertedAt: visit.convertedAt || null,
    lastEvent: lastEvent?.type || '',
    events: events.slice(-8).map((item) => ({
      type: item.type,
      path: item.path,
      at: item.at,
      meta: item.meta || null
    }))
  }
}

async function fetchVisitOverview(Visit, today = daysAgo(0)) {
  const weekAgo = daysAgo(7, today)
  const [visitorsToday, visitors7d, lurkers7d, converted7d] = await Promise.all([
    Visit.countDocuments({ lastSeenAt: { $gte: today } }),
    Visit.countDocuments({ lastSeenAt: { $gte: weekAgo } }),
    Visit.countDocuments({ lastSeenAt: { $gte: weekAgo }, convertedUserId: null }),
    Visit.countDocuments({ convertedAt: { $gte: weekAgo } })
  ])
  return { visitorsToday, visitors7d, lurkers7d, converted7d }
}

async function fetchAdminVisits(Visit, query = {}) {
  const { safePage, safeLimit, skip } = parseAdminPage(query)
  const match = {}
  const days = Number.parseInt(query.days, 10)
  if (Number.isFinite(days) && days > 0) {
    match.lastSeenAt = { $gte: daysAgo(days) }
  }
  if (query.converted === 'lurkers') match.convertedUserId = null
  if (query.converted === 'converted') match.convertedUserId = { $ne: null }

  const [total, rows] = await Promise.all([
    Visit.countDocuments(match),
    Visit.find(match).sort({ lastSeenAt: -1 }).skip(skip).limit(safeLimit).lean()
  ])

  return {
    visits: rows.map(serializeVisit),
    pagination: { page: safePage, limit: safeLimit, total }
  }
}

module.exports = {
  parseVisitPayload,
  recordVisit,
  serializeVisit,
  fetchVisitOverview,
  fetchAdminVisits
}
