#!/usr/bin/env bash

set -euo pipefail

PLUGIN_ID="${1:-openclaw-omni-router}"

openclaw plugins uninstall "${PLUGIN_ID}" --force --keep-files
