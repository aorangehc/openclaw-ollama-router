#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ollama-transcribe.sh -f <audio-file> [--base-url <url>] [--model <name>] [--language <lang>] [--prompt <text>] [--timeout <seconds>]

Transcribe an audio file through Ollama's OpenAI-compatible transcription endpoint.
The script prints only the final transcript to stdout so OpenClaw can consume it as
tools.media.audio CLI output.

Environment variables:
  OLLAMA_BASE_URL      Default: http://127.0.0.1:11434
  OLLAMA_STT_MODEL     Default: whisper
  OLLAMA_STT_LANGUAGE  Optional language hint, e.g. zh or en
  OLLAMA_STT_PROMPT    Optional transcription prompt
  OLLAMA_STT_TIMEOUT   Default: 120 seconds
EOF
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

strip_base_url_suffix() {
  local url="${1%/}"
  url="${url%/v1}"
  url="${url%/api}"
  printf '%s' "${url%/}"
}

audio_path=""
base_url="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
model="${OLLAMA_STT_MODEL:-whisper}"
language="${OLLAMA_STT_LANGUAGE:-}"
prompt="${OLLAMA_STT_PROMPT:-}"
timeout="${OLLAMA_STT_TIMEOUT:-120}"
keep_temp=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      audio_path="$2"
      shift 2
      ;;
    --base-url)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      base_url="$2"
      shift 2
      ;;
    --model)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      model="$2"
      shift 2
      ;;
    --language)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      language="$2"
      shift 2
      ;;
    --prompt)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      prompt="$2"
      shift 2
      ;;
    --timeout)
      [[ $# -ge 2 ]] || fail "Missing value for $1"
      timeout="$2"
      shift 2
      ;;
    --keep-temp)
      keep_temp=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      fail "Unknown option: $1"
      ;;
    *)
      if [[ -z "$audio_path" ]]; then
        audio_path="$1"
        shift
      else
        fail "Unexpected argument: $1"
      fi
      ;;
  esac
done

[[ -n "$audio_path" ]] || {
  usage >&2
  exit 2
}

[[ -f "$audio_path" ]] || fail "Audio file not found: $audio_path"

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v node >/dev/null 2>&1 || fail "node is required"

base_url="$(strip_base_url_suffix "$base_url")"
endpoint="${base_url}/v1/audio/transcriptions"

input_path="$audio_path"
converted_path=""
response_path="$(mktemp "${TMPDIR:-/tmp}/ollama-transcription-response.XXXXXX.json")"

cleanup() {
  rm -f "$response_path"
  if [[ "$keep_temp" != "1" && -n "$converted_path" ]]; then
    rm -f "$converted_path"
  fi
}

trap cleanup EXIT

# Re-encode to a simple mono WAV when ffmpeg is available. This makes Telegram
# voice notes and other chat attachments more likely to be accepted upstream.
if command -v ffmpeg >/dev/null 2>&1; then
  converted_path="$(mktemp "${TMPDIR:-/tmp}/ollama-transcription-audio.XXXXXX.wav")"
  if ffmpeg -nostdin -y -loglevel error -i "$audio_path" -ar 16000 -ac 1 "$converted_path" >/dev/null 2>&1; then
    input_path="$converted_path"
  else
    rm -f "$converted_path"
    converted_path=""
  fi
fi

curl_args=(
  -sS
  -o "$response_path"
  -w '%{http_code}'
  --max-time "$timeout"
  -X POST "$endpoint"
  -F "file=@${input_path}"
  -F "model=${model}"
)

if [[ -n "$language" ]]; then
  curl_args+=(-F "language=${language}")
fi

if [[ -n "$prompt" ]]; then
  curl_args+=(-F "prompt=${prompt}")
fi

http_code=""
if ! http_code="$(curl "${curl_args[@]}")"; then
  if [[ -s "$response_path" ]]; then
    printf 'Ollama transcription request failed:\n' >&2
    cat "$response_path" >&2
    printf '\n' >&2
  else
    printf 'Ollama transcription request failed before receiving a response body.\n' >&2
  fi
  exit 1
fi

if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
  printf 'Ollama transcription request returned HTTP %s.\n' "$http_code" >&2
  cat "$response_path" >&2
  printf '\n' >&2
  exit 1
fi

transcript="$(
  node --input-type=module - "$response_path" <<'EOF'
import { readFileSync } from 'node:fs';

const body = readFileSync(process.argv[2], 'utf8').trim();

if (!body) {
  process.stderr.write('Empty transcription response\n');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  process.stdout.write(body);
  process.exit(0);
}

const asText = (value) => typeof value === 'string' ? value.trim() : '';
const fromSegments = Array.isArray(parsed?.segments)
  ? parsed.segments.map((segment) => asText(segment?.text)).filter(Boolean).join(' ').trim()
  : '';
const transcript = [
  asText(parsed?.text),
  asText(parsed?.transcript),
  asText(parsed?.response),
  asText(parsed?.message?.content),
  fromSegments,
].find(Boolean);

if (!transcript) {
  process.stderr.write(`Unable to extract transcript from response: ${body}\n`);
  process.exit(1);
}

process.stdout.write(transcript);
EOF
)"

printf '%s\n' "$transcript"
