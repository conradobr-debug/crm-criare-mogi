# Transcritor local opcional Criare

O servidor local recebe um áudio por vez em `127.0.0.1:32123` e usa um
binário local do Whisper/whisper.cpp. Nenhum áudio é enviado a terceiros.

## Uso

1. Instale `whisper.cpp` e um modelo Whisper em português.
2. Defina `WHISPER_CPP_BIN` e `WHISPER_CPP_MODEL` quando necessário.
3. Execute `python3 server.py` (Windows: `py server.py`).
4. Mantenha o processo ativo somente enquanto quiser transcrever áudios.

Se o serviço estiver desligado, a captura de mensagens continua normalmente e
os áudios permanecem como `[Áudio sem transcrição]` pendentes.
