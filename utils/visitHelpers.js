const VISITOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ALLOWED_EVENTS = new Set([
  'pageview',
  'landing_cta_click',
  'landing_scroll_50',
  'landing_secondary_click',
  'faq_open',
  'register_start',
  'register_success',
  'login_success'
])

const MAX_PATH = 180
const MAX_REFERRER = 400
const MAX_UA = 280
const MAX_EVENTS = 40
const PAGEVIEW_DEBOUNCE_MS = 30000

function clip(value, max) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.slice(0, max)
}

function isValidVisitorId(value) {
  return typeof value === 'string' && VISITOR_ID_RE.test(value.trim())
}

function sanitizePath(value) {
  const raw = clip(value, MAX_PATH)
  if (!raw) return '/'
  try {
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'https://ignite-me.app')
    const path = url.pathname || '/'
    return path.length > MAX_PATH ? path.slice(0, MAX_PATH) : path
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`
  }
}

function referrerHost(referrer) {
  if (!referrer) return ''
  try {
    return new URL(referrer).host || ''
  } catch {
    return ''
  }
}

function parseDevice(userAgent) {
  const ua = String(userAgent || '')
  if (!ua) return 'unknown'
  if (/iPad|Tablet/i.test(ua)) return 'tablet'
  if (/Mobi|Android.+Mobile|iPhone|iPod/i.test(ua)) return 'mobile'
  return 'desktop'
}

function parseUtm(query = {}) {
  const source = clip(query.utmSource || query.utm_source, 80)
  const medium = clip(query.utmMedium || query.utm_medium, 80)
  const campaign = clip(query.utmCampaign || query.utm_campaign, 120)
  return { utmSource: source, utmMedium: medium, utmCampaign: campaign }
}

function parseEvent(value) {
  const event = String(value || '').trim()
  return ALLOWED_EVENTS.has(event) ? event : 'pageview'
}

function isSamePageviewDebounce(visit, path, now = Date.now()) {
  if (!visit?.lastSeenAt || visit.lastPath !== path) return false
  return now - new Date(visit.lastSeenAt).getTime() < PAGEVIEW_DEBOUNCE_MS
}

module.exports = {
  ALLOWED_EVENTS,
  MAX_EVENTS,
  PAGEVIEW_DEBOUNCE_MS,
  clip,
  isValidVisitorId,
  sanitizePath,
  referrerHost,
  parseDevice,
  parseUtm,
  parseEvent,
  isSamePageviewDebounce,
  MAX_PATH,
  MAX_REFERRER,
  MAX_UA
}
