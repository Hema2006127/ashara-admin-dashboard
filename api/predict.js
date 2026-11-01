/**
 * POST /api/predict  { token, landmarks: number[126] }  →  { top: [{letter, p}, …] }
 * Requires a token from /api/login. The model runs here; it is never sent to the browser.
 */
const { predict, verifyToken } = require('./_lib/model');

module.exports = (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const session = verifyToken(body.token);
    if (!session) return res.status(401).json({ error: 'انتهت الجلسة، سجّل دخول تاني' });

    const lm = body.landmarks;
    if (!Array.isArray(lm) || lm.length !== 126 || !lm.every(v => typeof v === 'number' && Number.isFinite(v))) {
        return res.status(400).json({ error: 'landmarks must be 126 numbers' });
    }

    try {
        return res.status(200).json({ top: predict(lm, 3) });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'الموديل مش متاح على السيرفر (MODEL_SECRET؟)' });
    }
};
