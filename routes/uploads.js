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

      const response = await fetch(`${IMGBB_UPLOAD_URL}?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        const msg = payload?.error?.message || payload?.data?.error?.message || 'Upload failed';
        console.error('[Uploads] ImgBB rejected upload:', msg);
        return res.status(502).json({ message: 'Image upload failed' });
      }

      const url = payload?.data?.url || payload?.data?.display_url;
      if (!url) {
        return res.status(502).json({ message: 'Upload did not return an image URL' });
      }

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

module.exports = router;
