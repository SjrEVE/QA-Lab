#!/usr/bin/env bash
set -euo pipefail

# Idempotent, bounded setup for a dedicated Linux QA user session.
# It creates two null sinks only. It never changes the default source/sink,
# installs packages, kills audio servers, unloads unrelated modules, or adds loopbacks.

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "BLOCKED: Linux is required." >&2
  exit 2
fi
if ! command -v pactl >/dev/null 2>&1; then
  echo "BLOCKED: pactl is required; install PulseAudio utilities using your VPS package policy." >&2
  exit 2
fi
if ! pactl info >/dev/null 2>&1; then
  echo "BLOCKED: no PulseAudio/PipeWire-Pulse user server is reachable." >&2
  exit 2
fi

ensure_sink() {
  local sink="$1"
  if pactl list short sinks | awk '{print $2}' | grep -Fxq "$sink"; then
    echo "exists: $sink"
    return
  fi
  pactl load-module module-null-sink "sink_name=$sink" "sink_properties=device.description=QA_Lab_${sink}" >/dev/null
  echo "created: $sink"
}

ensure_sink student_audio
ensure_sink tutor_audio

if ! pactl list short sources | awk '{print $2}' | grep -Fxq 'student_audio.monitor'; then
  echo "BLOCKED: student_audio.monitor was not created." >&2
  exit 3
fi
if ! pactl list short sources | awk '{print $2}' | grep -Fxq 'tutor_audio.monitor'; then
  echo "BLOCKED: tutor_audio.monitor was not created." >&2
  exit 3
fi
if pactl list short modules | grep -E 'module-loopback.*(tutor_audio\.monitor.*student_audio|student_audio\.monitor.*tutor_audio)' >/dev/null; then
  echo "BLOCKED: unsafe cross-sink loopback detected; inspect manually. No changes were made." >&2
  exit 4
fi

cat <<'EOF'
READY: isolated QA sinks exist.
- Feed synthetic student WAV/TTS only into sink: student_audio
- Select Chromium microphone source: student_audio.monitor
- Route Chromium/tutor playback only to sink: tutor_audio
- Record tutor output from: tutor_audio.monitor
- Do not create loopback links between either monitor and the opposite sink.
EOF
