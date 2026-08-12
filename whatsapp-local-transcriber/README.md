# Transcritor local opcional Criare

O servidor local recebe um áudio por vez em `127.0.0.1:32123` e usa um
binário local do Whisper/whisper.cpp. Nenhum áudio é enviado a terceiros.

## Uso

1. Instale `whisper.cpp` e um modelo Whisper em português.
2. Coloque `ggml-base.bin` ou `ggml-small.bin` em `~/Library/Application Support/Criare Transcriber/`, ou defina `WHISPER_CPP_BIN` e `WHISPER_CPP_MODEL`.
3. Execute `python3 server.py` (Windows: `py server.py`).
4. Mantenha o processo ativo somente enquanto quiser transcrever áudios.

O CRM consulta `http://127.0.0.1:32123/health` antes de enviar qualquer
arquivo. O status só aparece como disponível quando o binário e o modelo estão
prontos.

Se o serviço estiver desligado, a captura de mensagens continua normalmente e
os áudios permanecem como `[Áudio sem transcrição]` pendentes.

No CRM publicado, o atalho **Conversas e análises → Abrir Transcritor Criare**
chama o esquema local `criare-transcriber://start`. Ele depende do aplicativo
macOS `Criare Transcriber Launcher.app`, que contém uma cópia deste servidor e
o abre no Terminal sem acessar mensagens por conta própria.
