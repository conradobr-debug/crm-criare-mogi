on «event GURLGURL» theURL
  my startTranscriber()
end «event GURLGURL»

on run
  my startTranscriber()
end run

on startTranscriber()
  set appPath to POSIX path of (path to me)
  set serverPath to appPath & "Contents/Resources/server.py"
  set terminalCommand to "clear; if /usr/bin/curl -fsS --max-time 1 http://127.0.0.1:32123/health >/dev/null 2>&1; then printf 'Transcritor Criare\\n\\nO transcritor já está aberto e pronto para uso.\\n'; else printf 'Transcritor Criare\\n\\nMantenha esta janela aberta durante a atualização das conversas.\\nPara encerrar, pressione Control + C.\\n\\n'; /usr/bin/env python3 " & quoted form of serverPath & "; fi"

  tell application "Terminal"
    activate
    «event coredosc» terminalCommand
  end tell
end startTranscriber
