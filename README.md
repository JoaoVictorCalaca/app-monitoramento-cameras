# Mini VMS

Software web de monitoramento de câmeras IP inspirado no Hikvision iVMS-4200: visualização ao vivo em grade, gravação e playback.

- **Servidor:** Node.js sem dependências (`server.js`), usa FFmpeg para RTSP.
- **Interface:** React + Vite + Tailwind + shadcn/ui (pasta `web/`), compilada para `public/`.

## Requisitos
- Node.js 18+
- FFmpeg no PATH (ou `FFMPEG_PATH=C:\caminho\ffmpeg.exe`). Windows: `winget install Gyan.FFmpeg`

## Rodar
```powershell
npm --prefix web install
npm --prefix web run build
node server.js
```
Abra http://127.0.0.1:3000.

Desenvolvimento da interface com recarga automática (com o servidor rodando): `npm --prefix web run dev`.

## Funcionalidades
**Ao vivo**
- Grade de 1×1 até 8×8 (64 câmeras por página), com paginação (← →) e **sequência automática** de páginas (10 a 60 s).
- Duplo clique amplia a câmera no stream principal (HD), com **zoom digital** pela roda do mouse e arrastar para mover.
- Barra de ferramentas em cada janela: capturar imagem (JPG), gravar, ampliar.
- Tela cheia só da grade.

**Câmeras**
- Cadastro, edição e remoção. Modelos prontos para Hikvision, Intelbras, Dahua e RTSP genérico.
- **Filtro por IP ou nome**, inclusive por faixa: `192.168.3.10-50`. O filtro vale para a lista e para a grade.
- **Grupos/áreas** em árvore: criar (inclusive vazios), pesquisar, renomear (duplo clique) e excluir; "ver só este grupo na grade".
- **Mover câmeras entre grupos arrastando e soltando.** Ctrl+clique seleciona várias, Shift+clique seleciona um intervalo, e o arraste leva toda a seleção. Cada movimento pode ser desfeito pelo aviso.
- **Menu de contexto** (clique direito na área vazia da barra lateral): novo grupo, adicionar câmera, pesquisar grupos, expandir/recolher todos, selecionar câmeras visíveis.
- Status online/offline (verificação da porta RTSP a cada 60 s) e barra de status com contadores e relógio.
- Barra lateral recolhível (Ctrl+B).

**Gravação e playback**
- Botão REC por câmera. Grava o stream principal com `-c copy` (sem re-encodar), em MP4 de 2 min, em `data/recordings/<id>/`. Sem áudio.
- Aba **Gravações**: câmera e dia, linha do tempo de 24h, velocidade 0.5× a 8×, ±10 s, download do trecho.
- Reconecta sozinho se a câmera cair; Ctrl+C finaliza os MP4 antes de sair.
- Câmeras em **H.265** gravam, mas o Chrome pode não reproduzir; para playback no navegador use H.264.

## Como o ao vivo funciona (e por que carrega rápido)
- O navegador limita 6 conexões HTTP por servidor. Por isso **todas as câmeras da tela passam por uma única conexão** (`/api/live`), num protocolo binário simples: `[tipo][índice][tamanho][JPEG]`.
- Um FFmpeg por câmera/qualidade converte RTSP → JPEG e é compartilhado entre espectadores.
- O FFmpeg continua aquecido por 30 s depois que a câmera sai da tela (`STREAM_LINGER_MS`): voltar a uma página já vista é instantâneo, e o último quadro aparece na hora.
- Sondagem mínima do stream na abertura (`-probesize 32768 -analyzeduration 0`), com volta automática à sondagem normal se a câmera não abrir. `-fflags nobuffer` foi medido e dobrava o tempo de abertura, então não é usado.
- Grades 5×5+ usam 320 px a 5 fps.
- O que sobra do tempo de abertura é a espera pelo próximo quadro-chave da câmera. Para abrir mais rápido, reduza o **intervalo de I-frame** do substream na câmera (ex.: igual ao FPS).

Medido com câmeras Hikvision reais na rede local: 16 câmeras frias abrem com mediana de 3,2 s; 64 câmeras (8×8) abrem todas; páginas já vistas em ~15 ms.

## Configuração (variáveis de ambiente)
| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Endereço do servidor |
| `FFMPEG_PATH` | `ffmpeg` | Caminho do FFmpeg |
| `REC_DIR` | `data/recordings` | Pasta das gravações |
| `RETENTION_DAYS` | `7` | Apaga gravações mais antigas |
| `SEGMENT_SECONDS` | `120` | Duração de cada arquivo gravado |
| `STREAM_LINGER_MS` | `30000` | Tempo que o FFmpeg fica aquecido sem espectadores |

## Segurança
- Escuta só em 127.0.0.1. Para acesso na rede (`HOST=0.0.0.0`) **adicione login antes**: ainda não existe.
- Senhas das câmeras ficam em `data/cameras.json` em texto puro e nunca são enviadas ao navegador. A pasta `data/` está no `.gitignore`.

## Próximos passos
1. Limite de espaço em disco para gravações e opção de gravar o substream
2. Login/usuários
3. Descoberta ONVIF + PTZ
4. WebRTC/H.264 (go2rtc) no lugar de JPEG, para menos CPU
5. Eventos/alarmes de movimento
