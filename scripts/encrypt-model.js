/**
 * Encrypts the exported model so it can live in this public repo.
 *
 *   node scripts/encrypt-model.js <letters_model.bin> [model_test.json]
 *
 * Reads MODEL_SECRET from the environment or from .env.local (never committed).
 * If .env.local has no secret yet, a new one is generated and saved there —
 * copy it into Vercel → Project → Settings → Environment Variables.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encrypt, decrypt, parseModel, forward } = require('../api/_lib/model');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env.local');

function getSecret() {
    if (process.env.MODEL_SECRET) return process.env.MODEL_SECRET;
    if (fs.existsSync(envFile)) {
        const m = fs.readFileSync(envFile, 'utf8').match(/^MODEL_SECRET=(.+)$/m);
        if (m) return m[1].trim();
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.appendFileSync(envFile, `MODEL_SECRET=${secret}\n`);
    console.log(`New MODEL_SECRET generated and saved to .env.local`);
    return secret;
}

const [binPath, testPath] = process.argv.slice(2);
if (!binPath) {
    console.error('usage: node scripts/encrypt-model.js <letters_model.bin> [model_test.json]');
    process.exit(1);
}

const secret = getSecret();
const plain = fs.readFileSync(binPath);
const blob = encrypt(plain, secret);
const out = path.join(root, 'api', '_model', 'letters_model.enc');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, blob);
console.log(`Encrypted model -> ${path.relative(root, out)} (${(blob.length / 1024).toFixed(0)} KB)`);

// Round-trip + optional check against the PyTorch reference logits
const model = parseModel(decrypt(blob, secret));
if (testPath) {
    const ref = JSON.parse(fs.readFileSync(testPath, 'utf8'));
    let maxErr = 0, argmaxOk = 0;
    ref.inputs.forEach((x, k) => {
        const y = forward(model, x);
        y.forEach((v, i) => { maxErr = Math.max(maxErr, Math.abs(v - ref.logits[k][i])); });
        const a = y.indexOf(Math.max(...y)), b = ref.logits[k].indexOf(Math.max(...ref.logits[k]));
        argmaxOk += a === b;
    });
    console.log(`JS vs PyTorch: max |logit diff| = ${maxErr.toExponential(2)}, argmax match ${argmaxOk}/${ref.inputs.length}`);
    if (maxErr > 1e-3 || argmaxOk !== ref.inputs.length) process.exit(2);
}
