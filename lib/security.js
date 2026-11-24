// Segurança do Mini VMS: criptografia das senhas das câmeras, hash das senhas de usuário,
// exportação protegida por frase-senha e mascaramento de credenciais em mensagens.
// Só usa o módulo crypto do Node (sem dependências).
const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const ENC_PREFIX = 'enc:v1:';
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ---- Chave mestra (AES-256) para as senhas das câmeras ----
// Ordem: variável VMS_SECRET (recomendado em produção) -> arquivo de chave -> gera um novo arquivo.
function loadMasterKey(keyFile) {
  if (process.env.VMS_SECRET) {
    if (process.env.VMS_SECRET.length < 16) throw new Error('VMS_SECRET precisa ter pelo menos 16 caracteres');
    return { key: crypto.createHash('sha256').update(process.env.VMS_SECRET).digest(), source: 'VMS_SECRET' };
  }
  try {
    const k = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (k.length === 32) return { key: k, source: keyFile };
  } catch { /* não existe ainda */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, k.toString('base64'), { mode: 0o600 });
  return { key: k, source: keyFile, created: true };
}

const isEncrypted = (s) => typeof s === 'string' && s.startsWith(ENC_PREFIX);

function encryptSecret(key, plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decryptSecret(key, stored) {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored; // legado em texto puro (migrado na inicialização)
  const b = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// ---- Senhas de usuário: scrypt com sal (não reversível) ----
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(String(pw), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}

async function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64');
  const got = await scrypt(String(pw), Buffer.from(s, 'base64'), expected.length, SCRYPT);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// ---- Exportação com frase-senha (portável entre servidores com chaves diferentes) ----
async function sealWithPassphrase(passphrase, obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await scrypt(String(passphrase), salt, 32, SCRYPT);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

async function openWithPassphrase(passphrase, sealed) {
  const key = await scrypt(String(passphrase), Buffer.from(sealed.salt, 'base64'), 32, SCRYPT);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  try {
    return JSON.parse(Buffer.concat([d.update(Buffer.from(sealed.data, 'base64')), d.final()]).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Frase-senha incorreta ou arquivo corrompido'), { status: 400 });
  }
}

// Remove credenciais de URLs (ex.: rtsp://admin:senha@ip -> rtsp://***@ip) antes de mostrar/registrar mensagens
const redact = (s) => String(s ?? '').replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1***@');

const newToken = () => crypto.randomBytes(32).toString('base64url');

module.exports = {
  loadMasterKey, isEncrypted, encryptSecret, decryptSecret,
  hashPassword, verifyPassword, sealWithPassphrase, openWithPassphrase, redact, newToken,
};
