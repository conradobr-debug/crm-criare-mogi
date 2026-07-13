# Transcritor local Criare

Este serviço é opcional e gratuito. Ele escuta somente em `127.0.0.1`, usa
whisper.cpp localmente e apaga os arquivos temporários ao terminar. O CRM não
envia áudio para a OpenAI nem para outro serviço externo neste fluxo.

## Windows da Marianna

1. Coloque `whisper-cli.exe` (ou `main.exe`) nesta pasta.
2. Crie `models/` e coloque nela um modelo GGML, por exemplo
   `ggml-small.bin`.
3. Instale `ffmpeg` e deixe-o disponível no PATH quando os áudios não forem
   WAV.
4. No PowerShell, nesta pasta, execute:

```powershell
py server.py
```

O CRM mostrará `Transcritor local não está iniciado.` até que o serviço esteja
respondendo. O cache local usa o hash SHA-256 do arquivo para não transcrever o
mesmo áudio duas vezes.
