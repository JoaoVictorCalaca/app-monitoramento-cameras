// npm run demo: sobe o Mini VMS em modo demonstração (16 câmeras simuladas, gravações de exemplo, usuários prontos).
// Dados ficam em data-demo/ e nunca tocam em data/. Precisa de Node 18+ e FFmpeg.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

if (spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).error) {
  console.error('FFmpeg não encontrado. Instale (Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Linux: apt install ffmpeg) ou defina FFMPEG_PATH.');
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'public', 'index.html'))) {
  console.log('Compilando a interface (primeira execução)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const args of [['--prefix', 'web', 'install'], ['--prefix', 'web', 'run', 'build']]) {
    const r = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
}

const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'inherit', env: { ...process.env, VMS_DEMO: '1' } });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
