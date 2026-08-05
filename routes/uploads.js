const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');

const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

if (!IMGBB_API_KEY) {
  console.warn('[Uploads] IMGBB_API_KEY is not set — POST /api/uploads/image will return 503.');
  console.warn('[Uploads] Get a free key at https://api.imgbb.com/ and add it to .env');
}

// Max base64 payload (~13MB base64 ≈ ~9MB source image). The client caps images
// at 5MB, so this is a comfortable server-side ceiling.
const MAX_BASE64_LENGTH = 13 * 1024 * 1024;

const ALLOWED_IMAGE_HOSTS = new Set([
  'i.ibb.co',
  'ibb.co',
  'imgbb.com',
  'i.imgur.com',
  'imgur.com'
]);

function isAllowedImageUrl(rawUrl) {
  try {
    const { protocol, hostname } = new URL(rawUrl);
    if (protocol !== 'https:') return false;
    return ALLOWED_IMAGE_HOSTS.has(hostname)
      || hostname.endsWith('.ibb.co')
      || hostname.endsWith('.imgbb.com');
  } catch {
    return false;
  }
}

function inferImageContentType(rawUrl) {
  const lower = rawUrl.toLowerCase()
  if (lower.includes('.png')) return 'image/png'
  if (lower.includes('.webp')) return 'image/webp'
  if (lower.includes('.gif')) return 'image/gif'
  return 'image/jpeg'
}

// Proxies image uploads to ImgBB so the API key stays server-side and never
// ships in the client bundle. Accepts a base64-encoded image (no data: prefix).
// A route-scoped body parser allows the large payload without raising the
// global JSON limit for every other endpoint.
router.post(
  '/image',
  express.json({ limit: '15mb' }),
  authenticateToken,
  async (req, res) => {
    try {
      if (!IMGBB_API_KEY) {
        return res.status(503).json({
          message: 'Image uploads are not configured. Set IMGBB_API_KEY in the server environment.'
        });
      }

      const { image } = req.body || {};
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ message: 'image (base64 string) is required' });
      }
      if (image.length > MAX_BASE64_LENGTH) {
        return res.status(413).json({ message: 'Image too large' });
      }

      const form = new URLSearchParams();
      form.append('image', image);

      const startedAt = Date.now();
      console.log(`[Uploads] Proxying to ImgBB (base64 length=${image.length})`);

      const response = await fetch(`${IMGBB_UPLOAD_URL}?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
      });

      const imgbbMs = Date.now() - startedAt;
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        const msg = payload?.error?.message || payload?.data?.error?.message || 'Upload failed';
        console.error(`[Uploads] ImgBB rejected upload after ${imgbbMs}ms:`, msg);
        return res.status(502).json({ message: 'Image upload failed' });
      }

      const url = payload?.data?.url || payload?.data?.display_url;
      if (!url) {
        console.error(`[Uploads] ImgBB returned no URL after ${imgbbMs}ms`);
        return res.status(502).json({ message: 'Upload did not return an image URL' });
      }

      console.log(`[Uploads] ImgBB ok in ${imgbbMs}ms`);
      res.json({ url });
    } catch (error) {
      console.error('[Uploads] Image upload error:', error);
      res.status(500).json({
        message: 'Error uploading image',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Fetches a remote image server-side and returns a data URL. Used by the invite
// card export on mobile browsers where cross-origin canvas reads are blocked.
router.get('/image-data', authenticateToken, async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      return res.status(400).json({ message: 'url query parameter is required' });
    }
    if (!isAllowedImageUrl(rawUrl)) {
      return res.status(400).json({ message: 'Image URL is not allowed' });
    }

    const response = await fetch(rawUrl, { redirect: 'follow' });
    if (!response.ok) {
      return res.status(502).json({ message: 'Failed to fetch image' });
    }

    const rawContentType = response.headers.get('content-type') || ''
    const contentType = rawContentType.startsWith('image/')
      ? rawContentType.split(';')[0]
      : inferImageContentType(rawUrl)

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ message: 'Image too large' });
    }

    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
    res.json({ dataUrl });
  } catch (error) {
    console.error('[Uploads] Image data proxy error:', error);
    res.status(500).json({
      message: 'Error fetching image data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
