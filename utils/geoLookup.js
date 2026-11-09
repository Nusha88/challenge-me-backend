const net = require('net')
const geoip = require('geoip-lite')

function normalizeIp(value) {
  let ip = String(value || '').trim()
  if (!ip) return ''
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)
  return ip
}

function clientIp(req = {}) {
  const forwarded = req.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIp(forwarded.split(',')[0])
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return normalizeIp(String(forwarded[0]).split(',')[0])
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || '')
}

function isPublicIp(ip) {
  const value = normalizeIp(ip)
  if (!value || net.isIP(value) === 0) return false
  if (value === '::1' || value === '0.0.0.0') return false
  if (value.startsWith('127.') || value.startsWith('10.') || value.startsWith('192.168.') || value.startsWith('169.254.')) {
    return false
  }
  const match = value.match(/^172\.(\d+)\./)
  if (match) {
    const second = Number(match[1])
    if (second >= 16 && second <= 31) return false
  }
  if (value.toLowerCase().startsWith('fc') || value.toLowerCase().startsWith('fd') || value.toLowerCase().startsWith('fe80:')) {
    return false
  }
  return true
}

function countryName(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase()
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

function lookupGeo(ip) {
  if (!isPublicIp(ip)) return null
  try {
    const geo = geoip.lookup(ip)
    if (!geo?.country) return null
    return {
      countryCode: String(geo.country).toUpperCase(),
      country: countryName(geo.country),
      city: String(geo.city || '').trim(),
      timezone: String(geo.timezone || '').trim()
    }
  } catch {
    return null
  }
}

function lookupGeoFromRequest(req) {
  return lookupGeo(clientIp(req))
}

module.exports = {
  normalizeIp,
  clientIp,
  isPublicIp,
  countryName,
  lookupGeo,
  lookupGeoFromRequest
}
