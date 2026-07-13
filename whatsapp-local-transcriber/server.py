#!/usr/bin/env python3
"""Transcritor local opcional do CRM Criare.

O servidor só escuta em 127.0.0.1. Ele usa um binário local do whisper.cpp
(`whisper-cli` ou `main`) e um modelo GGML configurado por variável de ambiente.
Nenhum áudio é enviado para terceiros; os arquivos temporários são apagados.
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import pathlib
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

HOST = "127.0.0.1"
PORT = int(os.environ.get("CRIARE_TRANSCRIBER_PORT", "32123"))
ROOT = pathlib.Path(__file__).resolve().parent
CACHE_PATH = ROOT / ".transcription-cache.json"


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "content-type")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def load_cache() -> dict:
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def executable() -> Optional[str]:
    configured = os.environ.get("WHISPER_CPP_BIN", "").strip()
    candidates = [configured, str(ROOT / "whisper-cli.exe"), str(ROOT / "main.exe"), "whisper-cli", "main"]
    return next((candidate for candidate in candidates if candidate and (pathlib.Path(candidate).exists() or shutil.which(candidate))), None)


def model_path() -> Optional[str]:
    configured = os.environ.get("WHISPER_CPP_MODEL", "").strip()
    candidates = [configured, str(ROOT / "models" / "ggml-small.bin"), str(ROOT / "models" / "ggml-base.bin")]
    return next((candidate for candidate in candidates if candidate and pathlib.Path(candidate).exists()), None)


def transcribe(payload: dict) -> dict:
    encoded = str(payload.get("audio_base64", ""))
    message_id = str(payload.get("message_id", ""))[:300]
    supplied_hash = str(payload.get("sha256", ""))[:128]
    if not encoded or not message_id:
        raise ValueError("Áudio ou message_id ausente.")
    raw = base64.b64decode(encoded, validate=True)
    if not raw:
        raise ValueError("Arquivo de áudio vazio.")
    digest = hashlib.sha256(raw).hexdigest()
    if supplied_hash and supplied_hash != digest:
        raise ValueError("O hash do áudio não confere.")
    cache = load_cache()
    cached = cache.get(digest)
    if cached:
        return {"text": cached, "sha256": digest, "cached": True}
    binary = executable()
    model = model_path()
    if not binary or not model:
        error = "Transcritor local não está iniciado. Configure whisper.cpp e o modelo Whisper."
        return {"code": "TRANSCRIBER_NOT_STARTED", "error": error}

    mime = str(payload.get("mime_type", "audio/ogg"))
    suffix = mimetypes.guess_extension(mime) or ".audio"
    with tempfile.TemporaryDirectory(prefix="criare-audio-") as folder:
        safe_message_id = "".join(char if char.isalnum() or char in "-_" else "_" for char in message_id) or "audio"
        source = pathlib.Path(folder) / f"{safe_message_id}{suffix}"
        output = pathlib.Path(folder) / "result"
        source.write_bytes(raw)
        input_path = source
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg and suffix.lower() not in {".wav"}:
            converted = pathlib.Path(folder) / "audio.wav"
            subprocess.run([ffmpeg, "-y", "-i", str(source), "-ar", "16000", "-ac", "1", str(converted)], check=True, capture_output=True)
            input_path = converted
        command = [binary, "-m", model, "-l", "pt", "-nt", "-otxt", "-of", str(output), str(input_path)]
        subprocess.run(command, check=True, capture_output=True, text=True)
        transcript_file = pathlib.Path(f"{output}.txt")
        text = transcript_file.read_text(encoding="utf-8", errors="replace").strip() if transcript_file.exists() else ""
    if not text:
        raise RuntimeError("O Whisper não retornou texto.")
    cache[digest] = text
    save_cache(cache)
    return {"text": text, "sha256": digest, "cached": False}


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:  # noqa: N802
        json_response(self, 204, {})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/transcribe":
            json_response(self, 404, {"error": "Rota não encontrada."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 24 * 1024 * 1024:
                json_response(self, 413, {"error": "Áudio maior que 24 MB."})
                return
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            result = transcribe(payload)
            json_response(self, 200 if result.get("text") else 503, result)
        except (ValueError, json.JSONDecodeError) as error:
            json_response(self, 400, {"error": str(error)})
        except subprocess.CalledProcessError as error:
            json_response(self, 500, {"error": f"Falha no whisper.cpp: {error.stderr or error}"})
        except Exception as error:  # pragma: no cover - diagnóstico local
            json_response(self, 500, {"error": str(error)})

    def log_message(self, *_args) -> None:
        return


if __name__ == "__main__":
    print(f"Transcritor local Criare ouvindo em http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
