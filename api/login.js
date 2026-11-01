/**
 * POST /api/login  { name, code }  →  { token, name }
 * Checks the tester against the Supabase allow-list (model_tester_login RPC, which
 * also writes every attempt to model_access_log and blocks after 5 failures / 15 min).
 */
const { signToken } = require('./_lib/model');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hbzmrurfkvpqsturuyow.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_RQXz_J9lHVUyKEwU84hh6Q_bcVQ6RHh';

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = String(body.name || '').trim().slice(0, 80);
    const code = String(body.code || '').trim().slice(0, 40);
    if (!name || !code) return res.status(400).json({ error: 'اكتب الاسم وكود الدخول' });

    try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/model_tester_login`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                p_name: name,
                p_code: code,
                p_user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
            }),
        });
        if (!r.ok) {
            console.error('model_tester_login failed', r.status, await r.text());
            return res.status(502).json({ error: 'تعذر التحقق من الدخول (السيرفر)' });
        }
        const ok = await r.json();
        if (ok !== true) {
            return res.status(401).json({ error: 'الاسم أو الكود غلط، أو الدخول مقفول مؤقتاً بعد محاولات كتير' });
        }
        return res.status(200).json({ token: signToken(name), name });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'خطأ في السيرفر' });
    }
};
