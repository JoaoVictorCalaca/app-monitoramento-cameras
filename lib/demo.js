// Modo demonstração (VMS_DEMO=1): roda o Mini VMS inteiro sem nenhuma câmera real.
// Cada "câmera" é um vídeo gerado pelo próprio FFmpeg (fundo animado + nome + relógio + um objeto em movimento),
// então ao vivo, gravação e reprodução funcionam do mesmo jeito que com RTSP. Nenhuma conexão de rede é aberta.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEMO = process.env.VMS_DEMO === '1';

const USERS = [
  { username: 'admin', password: 'demo1234', role: 'admin' },
  { username: 'visitante', password: 'visitante1', role: 'operator' },
];

const LAYOUT = {
  Entrada: ['Portaria Principal', 'Portão da Garagem', 'Recepção', 'Catraca 1'],
  Estacionamento: ['Estacionamento A', 'Estacionamento B', 'Rampa do Subsolo', 'Cancela'],
  Escritório: ['Sala de Reuniões', 'Open Space', 'Copa', 'Corredor 2º andar'],
  'Depósito': ['Doca de Carga', 'Estoque 1', 'Estoque 2', 'Perímetro Externo'],
};
const OFFLINE = new Set(['Estoque 2']); // uma câmera "caída" para mostrar o estado de erro
const RECORDING = 3;                    // as primeiras câmeras já aparecem gravando

const groups = Object.keys(LAYOUT);

function cameras(encryptPass) {
  const brands = ['hikvision', 'intelbras', 'dahua'];
  const out = [];
  let i = 0;
  for (const [group, names] of Object.entries(LAYOUT)) {
    for (const name of names) {
      out.push({
        id: `demo-cam-${String(i + 1).padStart(2, '0')}`, name, brand: brands[i % 3], host: `10.0.0.${10 + i}`, port: 554,
        user: 'admin', pass: encryptPass('demo'), group, record: i < RECORDING, demoSeed: i + 1, demoOffline: OFFLINE.has(name),
      });
      i++;
    }
  }
  return out;
}

// ---- fonte de vídeo falsa ----
const FONTS = [process.env.VMS_FONT, 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'].filter(Boolean);
const font = FONTS.find((f) => { try { return fs.existsSync(f); } catch { return false; } });
const esc = (s) => String(s).replace(/[\\':%,;[\]]/g, ' '); // texto seguro dentro de um filtro do FFmpeg

// Argumentos de entrada do FFmpeg para a câmera. width/fps controlam o custo de CPU.
function inputArgs(cam, width, fps) {
  if (cam.demoOffline) return ['-rtsp_transport', 'tcp', '-timeout', '2000000', '-i', 'rtsp://127.0.0.1:9/offline']; // recusa na hora: aparece como "sem sinal"
  const w = Math.max(160, Math.round(width / 2) * 2), h = Math.round((w * 9) / 16 / 2) * 2;
  const seed = cam.demoSeed || 1;
  const fs_ = Math.max(8, Math.round(h / 26));
  const text = font
    ? `,drawtext=fontfile='${font.replace(/\\/g, '/').replace(':', '\\:')}':text='${esc(cam.name)}':x=${fs_ / 2}:y=${fs_ / 2}:fontsize=${fs_}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=4` +
      `,drawtext=fontfile='${font.replace(/\\/g, '/').replace(':', '\\:')}':text='%{localtime\\:%d/%m/%Y %T}':x=w-tw-${fs_ / 2}:y=h-th-${fs_ / 2}:fontsize=${fs_}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=4`
    : '';
  // um "vulto" cruza a cena em velocidade e altura diferentes por câmera (dá movimento para a detecção/linha do tempo)
  const bw = Math.round(h / 6), bh = Math.round(h / 3);
  const graph = `gradients=size=${w}x${h}:rate=${fps}:speed=0.012:seed=${seed * 7}:nb_colors=3` +
    `,drawbox=x='mod(t*${12 + (seed % 5) * 6}+${seed * 40},${w}-${bw})':y=${Math.round(h * (0.35 + (seed % 3) * 0.1))}:w=${bw}:h=${bh}:color=white@0.7:t=fill` + text;
  return ['-re', '-f', 'lavfi', '-i', graph];
}

// Gera gravações de exemplo (para a aba Gravações já ter linha do tempo): um clipe-base por câmera, copiado em vários horários.
function seedRecordings(cams, recDir, ffmpeg, log = () => {}) {
  const SEG = 60; // segundos
  const now = Date.now();
  for (const cam of cams.filter((c) => c.record)) {
    const dir = path.join(recDir, cam.id);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).some((f) => f.endsWith('.mp4'))) continue;
    const base = path.join(dir, '_base.mp4');
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputArgs(cam, 640, 10).filter((a) => a !== '-re'), '-t', String(SEG),
      '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', base], { timeout: 60000 });
    if (r.status !== 0 || !fs.existsSync(base)) { log(`Não foi possível gerar gravações de exemplo (${(r.stderr || '').toString().trim().split('\n').pop() || 'FFmpeg indisponível'})`); return; }
    let rnd = cam.demoSeed * 9301 + 49297; // aleatório determinístico: a demo é sempre igual
    const rand = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
    let n = 0;
    for (let t = now - 6 * 3600e3; t < now - 5 * 60e3; t += 5 * 60e3) {
      if (rand() < 0.3) continue; // lacunas, como numa gravação por movimento
      const start = new Date(t - (t % 1000));
      const p2 = (x) => String(x).padStart(2, '0');
      const name = `${start.getFullYear()}${p2(start.getMonth() + 1)}${p2(start.getDate())}_${p2(start.getHours())}${p2(start.getMinutes())}${p2(start.getSeconds())}.mp4`;
      const file = path.join(dir, name);
      fs.copyFileSync(base, file);
      fs.utimesSync(file, new Date(start.getTime() + SEG * 1000), new Date(start.getTime() + SEG * 1000)); // fim do trecho
      n++;
    }
    fs.rmSync(base, { force: true });
    log(`Demo: ${n} trechos gravados de exemplo em "${cam.name}"`);
  }
}

module.exports = { DEMO, USERS, groups, cameras, inputArgs, seedRecordings };
