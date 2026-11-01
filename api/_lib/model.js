/**
 * Server-side letter model: decrypts api/_model/letters_model.enc with MODEL_SECRET
 * (Vercel environment variable) and runs the MLP in plain JS.
 * The weights never leave the server — the browser only sends 126 landmark numbers.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODEL_PATH = path.join(__dirname, '..', '_model', 'letters_model.enc');

function keys(secret) {
    if (!secret || secret.length < 32) throw new Error('MODEL_SECRET is missing or too short');
    return {
        aes: crypto.createHash('sha256').update('ashara-model:' + secret).digest(),
        hmac: crypto.createHash('sha256').update('ashara-token:' + secret).digest(),
    };
}

// ── Encryption (AES-256-GCM): file = iv(12) | tag(16) | ciphertext ─────────
function encrypt(plain, secret) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', keys(secret).aes, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
}

function decrypt(blob, secret) {
    const d = crypto.createDecipheriv('aes-256-gcm', keys(secret).aes, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

// ── Model loading (cached per warm function instance) ──────────────────────
let cached = null;

function parseModel(bin) {
    const hlen = bin.readUInt32LE(0);
    const header = JSON.parse(bin.subarray(4, 4 + hlen).toString('utf8'));
    const raw = bin.subarray(4 + hlen);
    const weights = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const view = ([start, size]) => weights.subarray(start, start + size);
    const layers = header.layers.map(l => {
        const out = { ...l };
        for (const k of ['w', 'b', 'mean', 'var']) if (l[k]) out[k] = view(l[k]);
        return out;
    });
    return { labels: header.labels, input: header.input, layers };
}

function loadModel(secret = process.env.MODEL_SECRET) {
    if (!cached) cached = parseModel(decrypt(fs.readFileSync(MODEL_PATH), secret));
    return cached;
}

// ── Forward pass ───────────────────────────────────────────────────────────
// erf approximation (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7) for exact GELU
function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
}

function forward(model, input) {
    let x = Float64Array.from(input);
    for (const l of model.layers) {
        if (l.type === 'layernorm') {
            let mean = 0, v = 0;
            for (const a of x) mean += a;
            mean /= x.length;
            for (const a of x) v += (a - mean) ** 2;
            const inv = 1 / Math.sqrt(v / x.length + l.eps);
            x = x.map((a, i) => (a - mean) * inv * l.w[i] + l.b[i]);
        } else if (l.type === 'linear') {
            const y = new Float64Array(l.out);
            for (let o = 0; o < l.out; o++) {
                let s = l.b[o];
                const row = o * l.in;
                for (let i = 0; i < l.in; i++) s += l.w[row + i] * x[i];
                y[o] = s;
            }
            x = y;
        } else if (l.type === 'gelu') {
            x = x.map(a => 0.5 * a * (1 + erf(a / Math.SQRT2)));
        } else if (l.type === 'batchnorm') {
            x = x.map((a, i) => (a - l.mean[i]) / Math.sqrt(l.var[i] + l.eps) * l.w[i] + l.b[i]);
        }
    }
    return x;
}

function predict(input, topK = 3) {
    const model = loadModel();
    const logits = forward(model, input);
    const max = Math.max(...logits);
    const exps = logits.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return Array.from(exps, (e, i) => ({ letter: model.labels[i], p: e / sum }))
        .sort((a, b) => b.p - a.p)
        .slice(0, topK);
}

// ── Session tokens (HMAC-signed, no database lookup per request) ───────────
const b64u = buf => Buffer.from(buf).toString('base64url');

function signToken(name, hours = 4, secret = process.env.MODEL_SECRET) {
    const payload = b64u(JSON.stringify({ n: name, exp: Date.now() + hours * 3600e3 }));
    const sig = b64u(crypto.createHmac('sha256', keys(secret).hmac).update(payload).digest());
    return `${payload}.${sig}`;
}

function verifyToken(token, secret = process.env.MODEL_SECRET) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    const expected = b64u(crypto.createHmac('sha256', keys(secret).hmac).update(payload).digest());
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
}

module.exports = { encrypt, decrypt, parseModel, forward, predict, signToken, verifyToken, loadModel };
