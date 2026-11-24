// Mini VMS - servidor (sem dependências npm)
// Uso: node server.js   (requer FFmpeg no PATH ou variável FFMPEG_PATH)
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1'; // use 0.0.0.0 para acessar de outros PCs (adicione autenticação antes!)
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const DATA_FILE = path.join(__dirname, 'data', 'cameras.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REC_DIR = path.resolve(process.env.REC_DIR || path.join(__dirname, 'data', 'recordings'));
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 7);     // gravacoes mais antigas sao apagadas
const SEGMENT_SECONDS = Number(process.env.SEGMENT_SECONDS || 120); // tamanho de cada arquivo gravado
const STREAM_LINGER_MS = Number(process.env.STREAM_LINGER_MS || 30000); // FFmpeg continua aquecido apos o ultimo espectador sair
fs.mkdirSync(REC_DIR, { recursive: true });

// ---------- Armazenamento ----------
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
let cameras = [];
try { cameras = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { cameras = []; }
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(cameras, null, 2));

// Grupos/áreas: lista própria para permitir grupos vazios (criados antes de receber câmeras)
const GROUPS_FILE = path.join(__dirname, 'data', 'groups.json');
let savedGroups = [];
try { savedGroups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { savedGroups = []; }
const saveGroups = () => fs.writeFileSync(GROUPS_FILE, JSON.stringify(savedGroups, null, 2));
const allGroups = () => [...new Set([...savedGroups, ...cameras.map((c) => c.group).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
function groupName(v) {
  const g = String(v ?? '').trim();
  if (g.length > 60) throw Object.assign(new Error('Nome do grupo muito longo (máx. 60)'), { status: 400 });
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
  const auth = cam.user ? `${encodeURIComponent(cam.user)}:${encodeURIComponent(cam.pass || '')}@` : '';
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
});

function validate(b) {
  const host = String(b.host || '').trim();
  if (!/^[a-zA-Z0-9.\-]{1,253}$/.test(host)) return 'IP/host inválido';
  const port = Number(b.port || 554);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Porta inválida';
  if (!String(b.name || '').trim()) return 'Nome obrigatório';
  if (String(b.group || '').length > 60) return 'Grupo muito longo';
  for (const k of ['mainPath', 'subPath']) if (b[k] && /[\s\0]/.test(b[k])) return `${k} inválido`;
  return null;
}

// ---------- Ao vivo: 1 FFmpeg por câmera/qualidade, compartilhado, com cache do último frame ----------
const QUALITY = { low: { fps: 5, w: 320, q: 9 }, sub: { fps: 8, w: 640, q: 7 }, main: { fps: 12, w: 1280, q: 5 } };
const streams = new Map(); // "camId:quality" -> { key, camId, quality, proc, subs:Set<fn>, last, err, linger, restart }
const thumbs = new Map();  // camId -> último JPEG visto (mostrado na hora enquanto o stream conecta)

// Abre o stream mais rápido com sondagem mínima (medido: H.265 1,1s -> 0,3s). Se falhar, a câmera volta à sondagem normal.
// Obs.: '-fflags nobuffer' foi testado e DOBRAVA o tempo de abertura; não usar.
const fullProbe = new Set(); // camIds que precisam da sondagem normal
function ffArgs(cam, quality) {
  const Q = QUALITY[quality];
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
  const proc = spawn(FFMPEG, ffArgs(cam, s.quality), { stdio: ['ignore', 'pipe', 'pipe'] });
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
  proc.stderr.on('data', (d) => { s.err = (s.err + d).slice(-300); });
  proc.on('error', (e) => { s.err = e.code === 'ENOENT' ? 'FFmpeg não encontrado (instale ou defina FFMPEG_PATH)' : e.message; });
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

// ---------- Gravacao (FFmpeg -c copy em segmentos MP4, sem re-encodar) ----------
const recs = new Map(); // camId -> { proc, err, stopping, timer }
let shuttingDown = false;
const camDir = (id) => path.join(REC_DIR, id);

function startRecording(cam) {
  if (recs.has(cam.id) || shuttingDown) return;
  const dir = camDir(cam.id);
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-i', buildUrl(cam, 'main'),
    '-map', '0:v:0', '-c:v', 'copy', '-an',
    '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-segment_format', 'mp4',
    '-reset_timestamps', '1', '-strftime', '1', '%Y%m%d_%H%M%S.mp4',
  ];
  const proc = spawn(FFMPEG, args, { cwd: dir, stdio: ['pipe', 'ignore', 'pipe'] });
  const r = { proc, err: '', stopping: false, timer: null };
  recs.set(cam.id, r);
  proc.stderr.on('data', (d) => { r.err = (r.err + d).slice(-300); });
  proc.stdin.on('error', () => {});
  proc.on('error', (e) => { r.err = e.code === 'ENOENT' ? 'FFmpeg nao encontrado' : e.message; });
  proc.on('close', () => {
    recs.delete(cam.id);
    // se ainda deve gravar, reconecta depois de 10s (queda de rede/camera)
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
  if (r.timer) { clearTimeout(r.timer); recs.delete(id); return Promise.resolve(); }
  return new Promise((resolve) => {
    r.proc.once('close', resolve);
    try { r.proc.stdin.write('q'); } catch { r.proc.kill(); } // 'q' faz o FFmpeg fechar o MP4 corretamente
    setTimeout(() => r.proc.kill(), 5000);
  });
}

// Lista segmentos prontos de uma camera. Inicio = nome do arquivo (hora local); fim = momento em que o arquivo foi fechado.
function parseStart(file) {
  const m = file.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}
function listSegments(id) {
  let files = [];
  try { files = fs.readdirSync(camDir(id)).filter((f) => parseStart(f) !== null).sort(); } catch { return []; }
  // com a gravacao ativa, o arquivo mais recente ainda esta sendo escrito (sem indice) e nao e reproduzivel
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

// Serve MP4 com suporte a Range (necessario para avancar/voltar no player)
function serveVideo(req, res, file) {
  let st; try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end(); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = st.size - 1, code = 200;
  const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
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

for (const c of cameras) if (c.record) startRecording(c);

// ---------- Ao vivo multiplexado: todas as câmeras da tela em UMA conexão ----------
// O navegador só abre 6 conexões HTTP por servidor; com uma conexão por câmera, o resto ficava esperando.
// Protocolo binário: [tipo 1B][índice 1B][tamanho 4B BE][dados]  tipo 0=frame JPEG, 1=erro (texto), 2=prévia JPEG
function serveLive(req, res, url) {
  const items = (url.searchParams.get('s') || '').split(',').filter(Boolean).slice(0, 128);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.socket?.setNoDelay(true);
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
  res.on('close', () => { for (const [s, fn] of subs) unsubscribe(s, fn); });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/live' && req.method === 'GET') return serveLive(req, res, url);
    if (p === '/api/presets' && req.method === 'GET') return json(res, 200, PRESETS);
    if (p === '/api/cameras' && req.method === 'GET') return json(res, 200, cameras.map(publicCam));
    if (p === '/api/cameras' && req.method === 'POST') {
      const b = await readBody(req);
      const err = validate(b);
      if (err) return json(res, 400, { error: err });
      const cam = { id: crypto.randomUUID(), name: b.name.trim(), brand: PRESETS[b.brand] ? b.brand : 'generic', host: b.host.trim(),
        port: Number(b.port || 554), user: b.user || '', pass: b.pass || '', group: String(b.group || '').trim(),
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
      if (!d) return json(res, 400, { error: 'date invalida' });
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
      const next = { ...cam, name: String(b.name ?? cam.name).trim(), group: String(b.group ?? cam.group ?? '').trim(),
        host: String(b.host ?? cam.host).trim(), port: Number(b.port ?? cam.port), user: b.user ?? cam.user,
        brand: PRESETS[b.brand] ? b.brand : cam.brand, mainPath: b.mainPath || undefined, subPath: b.subPath || undefined,
        pass: b.pass ? b.pass : cam.pass };
      const err = validate(next);
      if (err) return json(res, 400, { error: err });
      const connChanged = ['host', 'port', 'user', 'pass', 'brand', 'mainPath', 'subPath'].some((k) => next[k] !== cam[k]);
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
      await stopRecording(m[1]); // as gravacoes ja feitas ficam em disco ate a retencao apagar
      cameras.splice(i, 1); save();
      for (const s of [...streams.values()]) if (s.camId === m[1]) closeStream(s);
      thumbs.delete(m[1]); online.delete(m[1]);
      return json(res, 200, { ok: true });
    }
    // arquivos estáticos
    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
}).listen(PORT, HOST, () => console.log(`Mini VMS em http://${HOST}:${PORT}`));

async function shutdown() {
  shuttingDown = true;
  for (const s of [...streams.values()]) closeStream(s);
  await Promise.all([...recs.keys()].map(stopRecording)); // fecha os MP4 antes de sair
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
