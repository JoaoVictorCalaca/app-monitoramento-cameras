// Mini VMS - servidor (sem dependências npm)
// Uso: node server.js   (requer FFmpeg no PATH ou variável FFMPEG_PATH)
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const sec = require('./lib/security');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1'; // 0.0.0.0 para acessar de outros PCs (use HTTPS na frente e COOKIE_SECURE=1)
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const demo = require('./lib/demo'); // VMS_DEMO=1: câmeras simuladas pelo FFmpeg, sem hardware
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, demo.DEMO ? 'data-demo' : 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const REC_DIR = path.resolve(process.env.REC_DIR || path.join(DATA_DIR, 'recordings'));
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 7);         // gravações mais antigas são apagadas
const SEGMENT_SECONDS = Number(process.env.SEGMENT_SECONDS || 120);     // duração de cada arquivo gravado
const STREAM_LINGER_MS = Number(process.env.STREAM_LINGER_MS || 30000); // FFmpeg fica aquecido após o último espectador sair
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';                // ligar quando servido via HTTPS
fs.mkdirSync(REC_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const CAMERAS_FILE = path.join(DATA_DIR, 'cameras.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');

const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
// grava num arquivo temporário e renomeia: não corrompe o JSON se o processo cair no meio
const writeJson = (f, v) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, f); };
const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------- Senhas das câmeras: criptografadas em repouso (AES-256-GCM) ----------
// O servidor precisa da senha original para abrir o RTSP, então não dá para usar hash; a chave fica separada do cameras.json
// (arquivo data/secret.key ou variável VMS_SECRET). Quem copiar só o cameras.json, um backup ou uma exportação não lê as senhas.
const master = sec.loadMasterKey(KEY_FILE);
if (master.created) console.log(`Chave de criptografia criada em ${KEY_FILE}. Faça backup dela: sem ela as senhas das câmeras não podem ser lidas.`);
const encryptPass = (plain) => sec.encryptSecret(master.key, plain);
function decryptPass(stored) {
  try { return sec.decryptSecret(master.key, stored); }
  catch { throw httpError(500, 'Não foi possível descriptografar a senha da câmera (chave diferente da usada para salvar?)'); }
}

let cameras = readJson(CAMERAS_FILE, []);
const save = () => writeJson(CAMERAS_FILE, cameras);
if (demo.DEMO && !cameras.length) { cameras = demo.cameras(encryptPass); save(); }
{ // migração: senhas em texto puro -> criptografadas
  let migrated = 0;
  for (const c of cameras) if (c.pass && !sec.isEncrypted(c.pass)) { c.pass = encryptPass(c.pass); migrated++; }
  if (migrated) { save(); console.log(`${migrated} senha(s) de câmera criptografada(s).`); }
}

// ---------- Grupos/áreas (lista própria para permitir grupos vazios) ----------
let savedGroups = readJson(GROUPS_FILE, demo.DEMO ? demo.groups : []);
const saveGroups = () => writeJson(GROUPS_FILE, savedGroups);
const allGroups = () => [...new Set([...savedGroups, ...cameras.map((c) => c.group).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
function groupName(v) {
  const g = String(v ?? '').trim();
  if (g.length > 60) throw httpError(400, 'Nome do grupo muito longo (máx. 60)');
  return g;
}
function ensureGroup(g) { if (g && !savedGroups.includes(g)) { savedGroups.push(g); saveGroups(); } }

const PRESETS = {
  hikvision: { port: 554, main: '/Streaming/Channels/101', sub: '/Streaming/Channels/102' },
  dahua:     { port: 554, main: '/cam/realmonitor?channel=1&subtype=0', sub: '/cam/realmonitor?channel=1&subtype=1' },
  intelbras: { port: 554, main: '/cam/realmonitor?channel=1&subtype=0', sub: '/cam/realmonitor?channel=1&subtype=1' },
  generic:   { port: 554, main: '/', sub: '' },
};

function buildUrl(cam, quality) {
  const p = PRESETS[cam.brand] || PRESETS.generic;
  const sub = cam.subPath ?? p.sub;
  const pathPart = quality !== 'main' && sub ? sub : (cam.mainPath ?? p.main);
  const auth = cam.user ? `${encodeURIComponent(cam.user)}:${encodeURIComponent(decryptPass(cam.pass))}@` : '';
  return `rtsp://${auth}${cam.host}:${cam.port || p.port}${pathPart.startsWith('/') ? '' : '/'}${pathPart}`;
}

// ---------- Status online (TCP na porta RTSP a cada 60s) ----------
const online = new Map(); // camId -> boolean
const tcpCheck = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 2000 });
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('timeout', () => { s.destroy(); resolve(false); });
  s.on('error', () => resolve(false));
});
async function checkOnline() {
  if (demo.DEMO) { for (const c of cameras) online.set(c.id, !c.demoOffline); return; } // demo: não abre conexões de rede
  const list = cameras.slice();
  let i = 0;
  const worker = async () => { while (i < list.length) { const c = list[i++]; online.set(c.id, await tcpCheck(c.host, c.port || 554)); } };
  await Promise.all(Array.from({ length: 32 }, worker));
}
checkOnline(); setInterval(checkOnline, 60000);

// Nunca devolve a senha ao navegador
const publicCam = (c) => ({
  id: c.id, name: c.name, brand: c.brand, host: c.host, port: c.port, user: c.user, mainPath: c.mainPath, subPath: c.subPath,
  group: c.group || '', record: !!c.record, recError: recs.get(c.id)?.err || '', online: online.has(c.id) ? online.get(c.id) : null,
  hasPassword: !!c.pass,
});

function validate(b) {
  const host = String(b.host || '').trim();
  if (!/^[a-zA-Z0-9.\-]{1,253}$/.test(host)) return 'IP/host inválido';
  const port = Number(b.port || 554);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Porta inválida';
  if (!String(b.name || '').trim()) return 'Nome obrigatório';
  if (String(b.name).length > 80) return 'Nome muito longo';
  if (String(b.group || '').length > 60) return 'Grupo muito longo';
  if (String(b.user || '').length > 64 || /[\s\0]/.test(String(b.user || ''))) return 'Usuário inválido';
  for (const k of ['mainPath', 'subPath']) if (b[k] && /[\s\0]/.test(b[k])) return `${k} inválido`;
  return null;
}

// ---------- Ao vivo: 1 FFmpeg por câmera/qualidade, compartilhado, com cache do último frame ----------
const QUALITY = { low: { fps: 5, w: 320, q: 9 }, sub: { fps: 8, w: 640, q: 7 }, main: { fps: 12, w: 1280, q: 5 } };
const streams = new Map(); // "camId:quality" -> { key, camId, quality, proc, subs:Set<fn>, last, err, linger, restart }
const thumbs = new Map();  // camId -> último JPEG visto (mostrado na hora enquanto o stream conecta)

// Abre o stream mais rápido com sondagem mínima (medido: H.265 1,1s -> 0,3s). Se falhar, a câmera volta à sondagem normal.
// Obs.: '-fflags nobuffer' foi testado e DOBRAVA o tempo de abertura; não usar.
const fullProbe = new Set();
function ffArgs(cam, quality) {
  const Q = QUALITY[quality];
  if (demo.DEMO) return ['-hide_banner', '-loglevel', 'error', ...demo.inputArgs(cam, Q.w, Q.fps), '-an', '-q:v', String(Q.q), '-f', 'mpjpeg', '-boundary_tag', 'vms', 'pipe:1'];
  return [
    '-hide_banner', '-loglevel', 'error',
    ...(fullProbe.has(cam.id) ? [] : ['-probesize', '32768', '-analyzeduration', '0']),
    '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-i', buildUrl(cam, quality),
    '-an', '-r', String(Q.fps), '-vf', `scale=${Q.w}:-2`, '-q:v', String(Q.q),
    '-f', 'mpjpeg', '-boundary_tag', 'vms', 'pipe:1',
  ];
}

// Separa os JPEGs da saída mpjpeg do FFmpeg (cada parte traz Content-length)
function mjpegParser(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const he = buf.indexOf('\r\n\r\n');
      if (he < 0) { if (buf.length > 4e6) buf = Buffer.alloc(0); return; }
      const m = /content-length:\s*(\d+)/i.exec(buf.subarray(0, he).toString('latin1'));
      if (!m) { buf = buf.subarray(he + 4); continue; }
      const start = he + 4, len = Number(m[1]);
      if (buf.length < start + len) return;
      onFrame(Buffer.from(buf.subarray(start, start + len)));
      buf = buf.subarray(start + len);
    }
  };
}

function spawnStream(s) {
  const cam = cameras.find((c) => c.id === s.camId);
  if (!cam) return closeStream(s);
  s.err = '';
  let proc;
  try { proc = spawn(FFMPEG, ffArgs(cam, s.quality), { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { s.err = sec.redact(e.message); for (const fn of s.subs) fn(1, Buffer.from(s.err)); return; }
  s.proc = proc;
  let gotFrame = false;
  proc.on('close', () => { if (!gotFrame && !fullProbe.has(cam.id)) fullProbe.add(cam.id); }); // sondagem mínima não serviu
  proc.stdout.on('data', mjpegParser((jpg) => {
    gotFrame = true;
    s.last = jpg;
    if (s.quality !== 'main') thumbs.set(s.camId, jpg);
    online.set(s.camId, true);
    for (const fn of s.subs) fn(0, jpg);
  }));
  // o FFmpeg cita a URL (com usuário:senha) nas mensagens de erro: mascarar antes de guardar
  proc.stderr.on('data', (d) => { s.err = sec.redact(s.err + d).slice(-300); });
  proc.on('error', (e) => { s.err = e.code === 'ENOENT' ? 'FFmpeg não encontrado (instale ou defina FFMPEG_PATH)' : sec.redact(e.message); });
  proc.on('close', () => {
    s.proc = null; s.last = null;
    if (streams.get(s.key) !== s) return; // foi fechado de propósito
    const msg = Buffer.from(s.err.trim().split('\n').pop() || 'Sem sinal da câmera');
    for (const fn of s.subs) fn(1, msg);
    // queda de rede/câmera: tenta de novo em 5s enquanto houver espectadores
    if (s.subs.size && !shuttingDown) s.restart = setTimeout(() => { s.restart = null; if (streams.get(s.key) === s) spawnStream(s); }, 5000);
    else closeStream(s);
  });
}

function openStream(cam, quality) {
  const key = `${cam.id}:${quality}`;
  let s = streams.get(key);
  if (!s) {
    s = { key, camId: cam.id, quality, proc: null, subs: new Set(), last: null, err: '', linger: null, restart: null };
    streams.set(key, s);
    spawnStream(s);
  }
  if (s.linger) { clearTimeout(s.linger); s.linger = null; }
  return s;
}

function subscribe(s, fn) {
  s.subs.add(fn);
  if (s.last) fn(0, s.last);                                  // frame atual: aparece na hora
  else if (thumbs.has(s.camId)) fn(2, thumbs.get(s.camId));   // prévia (último frame conhecido) enquanto conecta
}

function unsubscribe(s, fn) {
  s.subs.delete(fn);
  if (!s.subs.size && !s.linger) s.linger = setTimeout(() => closeStream(s), STREAM_LINGER_MS);
}

function closeStream(s) {
  if (streams.get(s.key) === s) streams.delete(s.key);
  clearTimeout(s.linger); clearTimeout(s.restart);
  if (s.proc) s.proc.kill();
}

function restartStreamsOf(camId) { for (const s of streams.values()) if (s.camId === camId && s.proc) s.proc.kill(); }
function closeStreamsOf(camId) { for (const s of [...streams.values()]) if (s.camId === camId) closeStream(s); thumbs.delete(camId); }

// ---------- Gravação (FFmpeg -c copy em segmentos MP4, sem re-encodar) ----------
const recs = new Map(); // camId -> { proc, err, stopping, timer }
let shuttingDown = false;
const camDir = (id) => path.join(REC_DIR, id);

function startRecording(cam) {
  if (recs.has(cam.id) || shuttingDown) return;
  const dir = camDir(cam.id);
  fs.mkdirSync(dir, { recursive: true });
  let url;
  try { url = demo.DEMO ? null : buildUrl(cam, 'main'); } catch (e) { recs.set(cam.id, { proc: null, err: e.message, stopping: false, timer: null }); return; }
  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...(demo.DEMO ? demo.inputArgs(cam, 854, 10) : ['-rtsp_transport', 'tcp', '-timeout', '10000000', '-i', url]),
    '-map', '0:v:0', ...(demo.DEMO ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '20'] : ['-c:v', 'copy']), '-an',
    '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-segment_format', 'mp4',
    '-reset_timestamps', '1', '-strftime', '1', '%Y%m%d_%H%M%S.mp4',
  ];
  const proc = spawn(FFMPEG, args, { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'] });
  const r = { proc, err: '', stopping: false, timer: null };
  recs.set(cam.id, r);
  proc.stderr.on('data', (d) => { r.err = sec.redact(r.err + d).slice(-300); });
  proc.stdin.on('error', () => {});
  proc.on('error', (e) => { r.err = e.code === 'ENOENT' ? 'FFmpeg não encontrado' : sec.redact(e.message); });
  proc.on('close', () => {
    recs.delete(cam.id);
    // se ainda deve gravar, reconecta depois de 10s (queda de rede/câmera)
    const still = cameras.find((c) => c.id === cam.id && c.record);
    if (still && !r.stopping && !shuttingDown) {
      const t = setTimeout(() => { recs.delete(cam.id); const c = cameras.find((x) => x.id === cam.id && x.record); if (c) startRecording(c); }, 10000);
      recs.set(cam.id, { proc: null, err: r.err || 'Reconectando...', stopping: false, timer: t });
    }
  });
}

function stopRecording(id) {
  const r = recs.get(id);
  if (!r) return Promise.resolve();
  r.stopping = true;
  if (!r.proc) { clearTimeout(r.timer); recs.delete(id); return Promise.resolve(); }
  return new Promise((resolve) => {
    r.proc.once('close', resolve);
    try { r.proc.stdin.write('q'); } catch { r.proc.kill(); } // 'q' faz o FFmpeg fechar o MP4 corretamente
    setTimeout(() => r.proc.kill(), 5000);
  });
}

// Lista segmentos prontos de uma câmera. Início = nome do arquivo (hora local); fim = momento em que o arquivo foi fechado.
function parseStart(file) {
  const m = file.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}
function listSegments(id) {
  let files = [];
  try { files = fs.readdirSync(camDir(id)).filter((f) => parseStart(f) !== null).sort(); } catch { return []; }
  // com a gravação ativa, o arquivo mais recente ainda está sendo escrito (sem índice) e não é reproduzível
  if (recs.get(id)?.proc) files.pop();
  const out = [];
  for (const file of files) {
    const st = fs.statSync(path.join(camDir(id), file));
    const start = parseStart(file), end = st.mtimeMs;
    if (st.size > 0 && end - start > 500) out.push({ file, start, end: Math.round(end), size: st.size });
  }
  return out;
}

function cleanupOld() {
  const limit = Date.now() - RETENTION_DAYS * 86400000;
  let dirs = [];
  try { dirs = fs.readdirSync(REC_DIR); } catch { return; }
  for (const d of dirs) {
    const dir = path.join(REC_DIR, d);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (parseStart(f) === null) continue;
        const p = path.join(dir, f);
        if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p);
      }
    } catch { /* ignora */ }
  }
}
cleanupOld(); setInterval(cleanupOld, 3600000);

// Serve MP4 com suporte a Range (necessário para avançar/voltar no player)
function serveVideo(req, res, file) {
  let st; try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end(); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = st.size - 1, code = 200;
  const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(+range[2], end); }
    else { start = Math.max(0, st.size - +range[2]); }
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    code = 206; h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  h['Content-Length'] = end - start + 1;
  res.writeHead(code, h);
  fs.createReadStream(file, { start, end }).pipe(res);
}

if (demo.DEMO) demo.seedRecordings(cameras, REC_DIR, FFMPEG, console.log);
for (const c of cameras) if (c.record) startRecording(c);

// ---------- Ao vivo multiplexado: todas as câmeras da tela em UMA conexão ----------
// O navegador só abre 6 conexões HTTP por servidor; com uma conexão por câmera, o resto ficava esperando.
// Protocolo binário: [tipo 1B][índice 1B][tamanho 4B BE][dados]  tipo 0=frame JPEG, 1=erro (texto), 2=prévia JPEG
const liveConns = new Map(); // token da sessão -> Set(res) (fechadas no logout)
function serveLive(req, res, url, token) {
  const items = (url.searchParams.get('s') || '').split(',').filter(Boolean).slice(0, 128);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.socket?.setNoDelay(true);
  if (!liveConns.has(token)) liveConns.set(token, new Set());
  liveConns.get(token).add(res);
  const subs = [];
  const pending = new Map(); // índice -> frame mais recente ainda não enviado (descarta frames velhos se a rede engasgar)
  let blocked = false;
  const send = (idx, type, buf) => {
    const h = Buffer.alloc(6); h[0] = type; h[1] = idx; h.writeUInt32BE(buf.length, 2);
    if (!res.write(Buffer.concat([h, buf]))) blocked = true;
  };
  items.forEach((item, idx) => {
    const [id, qp] = item.split(':');
    const cam = cameras.find((c) => c.id === id);
    if (!cam) return send(idx, 1, Buffer.from('Câmera não encontrada'));
    const s = openStream(cam, QUALITY[qp] ? qp : 'sub');
    const fn = (type, buf) => { if (type !== 1 && blocked) pending.set(idx, [type, buf]); else send(idx, type, buf); };
    subs.push([s, fn]);
    subscribe(s, fn);
  });
  res.on('drain', () => { blocked = false; for (const [i, [t, b]] of pending) send(i, t, b); pending.clear(); });
  res.on('close', () => {
    for (const [s, fn] of subs) unsubscribe(s, fn);
    liveConns.get(token)?.delete(res);
  });
}

// ---------- Usuários e sessões ----------
// Papéis: admin (tudo) e operador (só visualiza ao vivo, gravações e exporta a lista em CSV).
let users = readJson(USERS_FILE, []);
const saveUsers = () => writeJson(USERS_FILE, users);
const ROLES = ['admin', 'operator'];
if (demo.DEMO && !users.length) {
  Promise.all(demo.USERS.map(async (u) => ({ id: crypto.randomUUID(), username: u.username, role: u.role, hash: await sec.hashPassword(u.password), createdAt: new Date().toISOString() })))
    .then((list) => { if (!users.length) { users.push(...list); saveUsers(); } });
}
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt });
const sessions = new Map(); // token -> { userId, expires }
const SESSION_MS = SESSION_HOURS * 3600000;
let dummyHash = null; // usado quando o usuário não existe, para o tempo de resposta não revelar quais usuários existem
sec.hashPassword(crypto.randomBytes(16).toString('hex')).then((h) => { dummyHash = h; });

function validUsername(u) { return /^[a-zA-Z0-9._-]{3,32}$/.test(String(u || '')); }
function checkNewPassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) throw httpError(400, 'A senha precisa ter pelo menos 8 caracteres');
  if (s.length > 200) throw httpError(400, 'Senha muito longa');
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSession(req) {
  const token = parseCookies(req).vms_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
  const user = users.find((u) => u.id === s.userId);
  if (!user) { sessions.delete(token); return null; }
  return { token, user };
}

function startSession(res, user) {
  const token = sec.newToken();
  sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `vms_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${COOKIE_SECURE ? '; Secure' : ''}`);
}

function endSession(token) {
  sessions.delete(token);
  for (const r of liveConns.get(token) || []) r.destroy();
  liveConns.delete(token);
}

function revokeUserSessions(userId, exceptToken) {
  for (const [t, s] of sessions) if (s.userId === userId && t !== exceptToken) endSession(t);
}

const clearCookie = (res) => res.setHeader('Set-Cookie', `vms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`);
setInterval(() => { const now = Date.now(); for (const [t, s] of sessions) if (s.expires < now) endSession(t); }, 600000);

// Limite de tentativas de login por IP: 5 erros em 15 min bloqueiam por 5 min
const loginFails = new Map(); // ip -> { count, first, blockedUntil }
function loginBlocked(ip) {
  const f = loginFails.get(ip);
  return f && f.blockedUntil > Date.now() ? Math.ceil((f.blockedUntil - Date.now()) / 1000) : 0;
}
function loginFailed(ip) {
  const now = Date.now();
  let f = loginFails.get(ip);
  if (!f || now - f.first > 15 * 60000) f = { count: 0, first: now, blockedUntil: 0 };
  f.count++;
  if (f.count >= 5) { f.blockedUntil = now + 5 * 60000; f.count = 0; f.first = now; }
  loginFails.set(ip, f);
}

// ---------- Exportação / importação ----------
const camForExport = (c, withPass) => ({
  name: c.name, brand: c.brand, host: c.host, port: c.port, user: c.user, group: c.group || '',
  mainPath: c.mainPath, subPath: c.subPath, ...(withPass ? { pass: decryptPass(c.pass) } : {}),
});

async function buildExport(includePasswords, passphrase) {
  const base = { format: 'minivms-config', version: 1, exportedAt: new Date().toISOString(), cameraCount: cameras.length };
  const payload = { groups: allGroups(), cameras: cameras.map((c) => camForExport(c, includePasswords)) };
  if (!includePasswords) return { ...base, includesPasswords: false, ...payload };
  checkNewPassword(passphrase); // mesma regra de tamanho mínimo
  return { ...base, includesPasswords: true, encrypted: await sec.sealWithPassphrase(passphrase, payload) };
}

const camKey = (c) => `${String(c.host).trim().toLowerCase()}:${Number(c.port || 554)}:${c.mainPath || ''}`;

async function importConfig(body) {
  const cfg = body.config;
  if (!cfg || cfg.format !== 'minivms-config' || cfg.version !== 1) throw httpError(400, 'Arquivo não é uma exportação do Mini VMS');
  let payload = cfg;
  if (cfg.encrypted) {
    if (!body.passphrase) throw httpError(400, 'Este arquivo contém senhas: informe a frase-senha usada na exportação');
    payload = await sec.openWithPassphrase(body.passphrase, cfg.encrypted);
  }
  const list = Array.isArray(payload.cameras) ? payload.cameras : [];
  if (list.length > 5000) throw httpError(400, 'Arquivo com câmeras demais');
  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  const result = { added: 0, updated: 0, removed: 0, invalid: [], withoutPassword: 0 };
  const seen = new Set();
  const byKey = new Map(cameras.map((c) => [camKey(c), c]));
  for (const raw of list) {
    const item = {
      name: String(raw.name || '').trim(), brand: PRESETS[raw.brand] ? raw.brand : 'generic', host: String(raw.host || '').trim(),
      port: Number(raw.port || 554), user: String(raw.user || ''), group: groupName(raw.group),
      mainPath: raw.mainPath || undefined, subPath: raw.subPath || undefined,
    };
    const err = validate(item);
    if (err) { result.invalid.push(`${item.name || item.host || '?'}: ${err}`); continue; }
    const key = camKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const hasPass = typeof raw.pass === 'string';
    const existing = byKey.get(key);
    if (existing) {
      const connChanged = item.user !== existing.user || item.brand !== existing.brand || item.subPath !== existing.subPath ||
        (hasPass && raw.pass !== decryptPass(existing.pass));
      Object.assign(existing, item, hasPass ? { pass: encryptPass(raw.pass) } : {});
      if (connChanged) restartStreamsOf(existing.id);
      result.updated++;
    } else {
      // gravação não é importada ligada (evita encher o disco de repente)
      cameras.push({ id: crypto.randomUUID(), ...item, pass: hasPass ? encryptPass(raw.pass) : '', record: false });
      if (!hasPass) result.withoutPassword++;
      result.added++;
    }
  }
  if (mode === 'replace') {
    const keep = [];
    for (const c of cameras) {
      if (seen.has(camKey(c))) { keep.push(c); continue; }
      await stopRecording(c.id); closeStreamsOf(c.id); online.delete(c.id);
      result.removed++;
    }
    cameras = keep;
    savedGroups = [];
  }
  for (const g of Array.isArray(payload.groups) ? payload.groups : []) {
    const name = groupName(g);
    if (name && !savedGroups.includes(name)) savedGroups.push(name);
  }
  save(); saveGroups();
  checkOnline();
  return result;
}

function camerasCsv() {
  // ';' e BOM para abrir direto no Excel em português; células que começam com = + - @ ganham ' (evita injeção de fórmula)
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['Nome', 'Grupo', 'IP', 'Porta', 'Usuário', 'Marca', 'Status', 'Gravando']];
  for (const c of [...cameras].sort((a, b) => (a.group || '').localeCompare(b.group || '', 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'))) {
    const st = online.get(c.id);
    rows.push([c.name, c.group || '', c.host, c.port, c.user, c.brand, st === true ? 'Online' : st === false ? 'Offline' : 'Desconhecido', c.record ? 'Sim' : 'Não']);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; " +
  "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit = 1e6) => new Promise((resolve, reject) => {
  let d = '';
  req.on('data', (c) => { d += c; if (d.length > limit) { reject(httpError(413, 'Requisição grande demais')); req.destroy(); } });
  req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { reject(httpError(400, 'JSON inválido')); } });
});
const clientIp = (req) => req.socket.remoteAddress || '?';

async function handleAuth(req, res, p, session) {
  if (p === '/api/auth/me' && req.method === 'GET') {
    if (!session) return json(res, 401, { error: 'Não autenticado', setupRequired: users.length === 0 && !demo.DEMO, ...(demo.DEMO ? { demo: demo.USERS.map(({ username, password, role }) => ({ username, password, role })) } : {}) });
    return json(res, 200, { user: publicUser(session.user), demo: demo.DEMO });
  }
  if (p === '/api/auth/setup' && req.method === 'POST') { // cria o primeiro administrador (só quando não há usuários)
    if (users.length) return json(res, 409, { error: 'O sistema já foi configurado' });
    const b = await readBody(req);
    if (!validUsername(b.username)) return json(res, 400, { error: 'Usuário: 3 a 32 caracteres (letras, números, . _ -)' });
    checkNewPassword(b.password);
    const u = { id: crypto.randomUUID(), username: b.username, role: 'admin', hash: await sec.hashPassword(b.password), createdAt: new Date().toISOString() };
    users.push(u); saveUsers();
    startSession(res, u);
    return json(res, 201, { user: publicUser(u) });
  }
  if (p === '/api/auth/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const wait = loginBlocked(ip);
    if (wait) return json(res, 429, { error: `Muitas tentativas. Tente de novo em ${wait}s.` });
    const b = await readBody(req);
    const u = users.find((x) => x.username.toLowerCase() === String(b.username || '').toLowerCase());
    const ok = await sec.verifyPassword(String(b.password || ''), u ? u.hash : dummyHash);
    if (!u || !ok) { loginFailed(ip); return json(res, 401, { error: 'Usuário ou senha inválidos' }); }
    loginFails.delete(ip);
    startSession(res, u);
    return json(res, 200, { user: publicUser(u) });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    if (session) endSession(session.token);
    clearCookie(res);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/auth/password' && req.method === 'POST') { // trocar a própria senha
    if (!session) return json(res, 401, { error: 'Não autenticado' });
    const b = await readBody(req);
    if (!(await sec.verifyPassword(String(b.current || ''), session.user.hash))) return json(res, 400, { error: 'Senha atual incorreta' });
    checkNewPassword(b.next);
    session.user.hash = await sec.hashPassword(b.next); saveUsers();
    revokeUserSessions(session.user.id, session.token); // derruba as outras sessões desse usuário
    return json(res, 200, { ok: true });
  }
  return false;
}

async function handleUsers(req, res, p, session) {
  if (p === '/api/users' && req.method === 'GET') return json(res, 200, users.map(publicUser));
  if (p === '/api/users' && req.method === 'POST') {
    const b = await readBody(req);
    if (!validUsername(b.username)) return json(res, 400, { error: 'Usuário: 3 a 32 caracteres (letras, números, . _ -)' });
    if (users.some((u) => u.username.toLowerCase() === b.username.toLowerCase())) return json(res, 409, { error: 'Esse usuário já existe' });
    if (!ROLES.includes(b.role)) return json(res, 400, { error: 'Perfil inválido' });
    checkNewPassword(b.password);
    const u = { id: crypto.randomUUID(), username: b.username, role: b.role, hash: await sec.hashPassword(b.password), createdAt: new Date().toISOString() };
    users.push(u); saveUsers();
    return json(res, 201, publicUser(u));
  }
  const m = p.match(/^\/api\/users\/([\w-]+)$/);
  if (!m) return false;
  const u = users.find((x) => x.id === m[1]);
  if (!u) return json(res, 404, { error: 'Usuário não encontrado' });
  const admins = users.filter((x) => x.role === 'admin').length;
  if (req.method === 'PUT') { // trocar perfil e/ou redefinir senha
    const b = await readBody(req);
    if (b.role !== undefined) {
      if (!ROLES.includes(b.role)) return json(res, 400, { error: 'Perfil inválido' });
      if (u.role === 'admin' && b.role !== 'admin' && admins === 1) return json(res, 400, { error: 'Precisa existir pelo menos um administrador' });
      u.role = b.role;
    }
    if (b.password) { checkNewPassword(b.password); u.hash = await sec.hashPassword(b.password); }
    saveUsers();
    revokeUserSessions(u.id, u.id === session.user.id ? session.token : undefined);
    return json(res, 200, publicUser(u));
  }
  if (req.method === 'DELETE') {
    if (u.id === session.user.id) return json(res, 400, { error: 'Você não pode excluir o próprio usuário' });
    if (u.role === 'admin' && admins === 1) return json(res, 400, { error: 'Precisa existir pelo menos um administrador' });
    users = users.filter((x) => x.id !== u.id); saveUsers();
    revokeUserSessions(u.id);
    return json(res, 200, { ok: true });
  }
  return false;
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    const isApi = p.startsWith('/api/') || p.startsWith('/rec/');
    if (isApi) {
      // proteção contra CSRF: além do cookie SameSite=Strict, toda alteração precisa vir como JSON
      // (um formulário de outro site não consegue enviar application/json sem permissão do servidor)
      if (req.method !== 'GET' && req.method !== 'HEAD' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return json(res, 415, { error: 'Envie os dados como JSON' });
      }
      const session = getSession(req);
      if (p.startsWith('/api/auth/')) { const r = await handleAuth(req, res, p, session); if (r !== false) return; return json(res, 404, { error: 'Não encontrado' }); }
      if (!session) return json(res, 401, { error: 'Não autenticado', setupRequired: users.length === 0 });
      const isAdmin = session.user.role === 'admin';
      // operador: só leitura (ao vivo, gravações, lista e CSV). Tudo que altera algo ou expõe a configuração é de admin.
      const adminOnly = req.method !== 'GET' || p.startsWith('/api/users') || p === '/api/export';
      if (adminOnly && !isAdmin) return json(res, 403, { error: 'Apenas administradores podem fazer isso' });

      if (p.startsWith('/api/users')) { const r = await handleUsers(req, res, p, session); if (r !== false) return; return json(res, 404, { error: 'Não encontrado' }); }
      if (p === '/api/live' && req.method === 'GET') return serveLive(req, res, url, session.token);
      if (p === '/api/presets' && req.method === 'GET') return json(res, 200, PRESETS);
      if (p === '/api/cameras' && req.method === 'GET') return json(res, 200, cameras.map(publicCam));
      if (p === '/api/export/cameras.csv' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="cameras.csv"', 'Cache-Control': 'no-store' });
        return res.end(camerasCsv());
      }
      if (p === '/api/export' && req.method === 'POST') { // POST: a frase-senha vai no corpo, nunca na URL
        const b = await readBody(req);
        return json(res, 200, await buildExport(!!b.includePasswords, b.passphrase));
      }
      if (p === '/api/import' && req.method === 'POST') return json(res, 200, await importConfig(await readBody(req, 20e6)));
      if (p === '/api/cameras' && req.method === 'POST') {
        const b = await readBody(req);
        const err = validate(b);
        if (err) return json(res, 400, { error: err });
        const cam = { id: crypto.randomUUID(), name: b.name.trim(), brand: PRESETS[b.brand] ? b.brand : 'generic', host: b.host.trim(),
          port: Number(b.port || 554), user: b.user || '', pass: encryptPass(b.pass || ''), group: groupName(b.group),
          mainPath: b.mainPath || undefined, subPath: b.subPath || undefined };
        cameras.push(cam); save();
        tcpCheck(cam.host, cam.port).then((ok) => online.set(cam.id, ok));
        return json(res, 201, publicCam(cam));
      }
      if (p === '/api/cameras/group' && req.method === 'POST') { // move várias câmeras para um grupo ('' = sem grupo)
        const b = await readBody(req);
        const group = groupName(b.group);
        const ids = new Set(Array.isArray(b.ids) ? b.ids : []);
        let n = 0;
        for (const c of cameras) if (ids.has(c.id)) { c.group = group; n++; }
        save(); ensureGroup(group);
        return json(res, 200, { updated: n });
      }
      if (p === '/api/groups' && req.method === 'GET') return json(res, 200, allGroups());
      if (p === '/api/groups' && req.method === 'POST') { // criar grupo (pode ficar vazio)
        const g = groupName((await readBody(req)).name);
        if (!g) return json(res, 400, { error: 'Informe o nome do grupo' });
        if (allGroups().some((x) => x.toLowerCase() === g.toLowerCase())) return json(res, 409, { error: 'Já existe um grupo com esse nome' });
        ensureGroup(g);
        return json(res, 201, allGroups());
      }
      if (p === '/api/groups' && req.method === 'PUT') { // renomear: { from, to }
        const b = await readBody(req);
        const from = groupName(b.from), to = groupName(b.to);
        if (!from || !to) return json(res, 400, { error: 'Nome inválido' });
        if (from !== to && allGroups().some((x) => x !== from && x.toLowerCase() === to.toLowerCase())) return json(res, 409, { error: 'Já existe um grupo com esse nome' });
        for (const c of cameras) if (c.group === from) c.group = to;
        savedGroups = savedGroups.filter((x) => x !== from); ensureGroup(to);
        save(); saveGroups();
        return json(res, 200, allGroups());
      }
      if (p === '/api/groups' && req.method === 'DELETE') { // excluir: câmeras do grupo ficam "sem grupo"
        const g = groupName(url.searchParams.get('name'));
        let n = 0;
        for (const c of cameras) if (c.group === g) { c.group = ''; n++; }
        savedGroups = savedGroups.filter((x) => x !== g);
        save(); saveGroups();
        return json(res, 200, { moved: n, groups: allGroups() });
      }
      let m = p.match(/^\/api\/cameras\/([\w-]+)\/record$/);
      if (m && req.method === 'POST') {
        const cam = cameras.find((c) => c.id === m[1]);
        if (!cam) return json(res, 404, { error: 'não encontrada' });
        const b = await readBody(req);
        cam.record = !!b.enabled; save();
        if (cam.record) startRecording(cam); else await stopRecording(cam.id);
        return json(res, 200, publicCam(cam));
      }
      m = p.match(/^\/api\/recordings\/([\w-]+)$/);
      if (m && req.method === 'GET') { // ?date=YYYY-MM-DD (dia local) -> segmentos que tocam esse dia
        const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(url.searchParams.get('date') || '');
        if (!d) return json(res, 400, { error: 'date inválida' });
        const from = new Date(+d[1], +d[2] - 1, +d[3]).getTime(), to = from + 86400000;
        return json(res, 200, { dayStart: from, segments: listSegments(m[1]).filter((s) => s.end > from && s.start < to) });
      }
      m = p.match(/^\/rec\/([\w-]+)\/(\d{8}_\d{6}\.mp4)$/);
      if (m && req.method === 'GET') return serveVideo(req, res, path.join(camDir(m[1]), m[2]));
      m = p.match(/^\/api\/cameras\/([\w-]+)$/);
      if (m && req.method === 'PUT') { // editar; senha em branco mantém a atual
        const cam = cameras.find((c) => c.id === m[1]);
        if (!cam) return json(res, 404, { error: 'não encontrada' });
        const b = await readBody(req);
        const next = { ...cam, name: String(b.name ?? cam.name).trim(), group: groupName(b.group ?? cam.group ?? ''),
          host: String(b.host ?? cam.host).trim(), port: Number(b.port ?? cam.port), user: b.user ?? cam.user,
          brand: PRESETS[b.brand] ? b.brand : cam.brand, mainPath: b.mainPath || undefined, subPath: b.subPath || undefined };
        const err = validate(next);
        if (err) return json(res, 400, { error: err });
        const passChanged = !!b.pass && b.pass !== decryptPass(cam.pass);
        if (passChanged) next.pass = encryptPass(b.pass);
        const connChanged = passChanged || ['host', 'port', 'user', 'brand', 'mainPath', 'subPath'].some((k) => next[k] !== cam[k]);
        Object.assign(cam, next); save();
        if (connChanged) {
          restartStreamsOf(cam.id);
          if (cam.record) { await stopRecording(cam.id); startRecording(cam); }
          tcpCheck(cam.host, cam.port).then((ok) => online.set(cam.id, ok));
        }
        return json(res, 200, publicCam(cam));
      }
      if (m && req.method === 'DELETE') {
        const i = cameras.findIndex((c) => c.id === m[1]);
        if (i < 0) return json(res, 404, { error: 'não encontrada' });
        await stopRecording(m[1]); // as gravações já feitas ficam em disco até a retenção apagar
        cameras.splice(i, 1); save();
        closeStreamsOf(m[1]); online.delete(m[1]);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Não encontrado' });
    }
    // arquivos estáticos da interface (públicos; os dados só saem pela API autenticada)
    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...(ext === '.html' ? { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' } : {}),
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(sec.redact(e.stack || e.message));
    if (!res.headersSent) json(res, status, { error: status >= 500 && !e.status ? 'Erro interno do servidor' : sec.redact(e.message) });
    else res.destroy();
  }
}).listen(PORT, HOST, () => {
  console.log(`Mini VMS em http://${HOST}:${PORT}${demo.DEMO ? '  [MODO DEMONSTRAÇÃO: câmeras simuladas]' : ''}`);
  if (!users.length && !demo.DEMO) console.log('Nenhum usuário ainda: abra o endereço acima para criar o administrador.');
});

async function shutdown() {
  shuttingDown = true;
  for (const s of [...streams.values()]) closeStream(s);
  await Promise.all([...recs.keys()].map(stopRecording)); // fecha os MP4 antes de sair
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
