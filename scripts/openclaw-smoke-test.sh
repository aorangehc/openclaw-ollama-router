#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-all}"
AGENT_ID="${OPENCLAW_AGENT_ID:-main}"

VISION_IMAGE_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXKQAAAAASUVORK5CYII="

extract_session_id() {
  local output="$1"
  printf '%s\n' "${output}" | jq -r '.result.meta.agentMeta.sessionId'
}

print_tool_result() {
  local session_file="$1"
  local tool_name="$2"

  local tool_result
  tool_result="$(jq -cr --arg tool_name "${tool_name}" 'select(.type == "message" and .message.role == "toolResult" and .message.toolName == $tool_name) | .message.details' "${session_file}" | tail -n 1)"

  if [[ -z "${tool_result}" ]]; then
    echo "No ${tool_name} toolResult found in ${session_file}" >&2
    exit 1
  fi

  echo "--> ${tool_name}"
  printf '%s\n' "${tool_result}" | jq .
}

run_case() {
  local name="$1"
  local message="$2"
  shift 2
  local tools=("$@")

  echo "==> ${name}"

  local output
  output="$(openclaw agent --agent "${AGENT_ID}" --message "${message}" --json)"

  local session_id
  session_id="$(extract_session_id "${output}")"

  if [[ -z "${session_id}" || "${session_id}" == "null" ]]; then
    echo "Failed to resolve sessionId from OpenClaw output" >&2
    printf '%s\n' "${output}" >&2
    exit 1
  fi

  local session_file="${HOME}/.openclaw/agents/${AGENT_ID}/sessions/${session_id}.jsonl"

  for tool_name in "${tools[@]}"; do
    print_tool_result "${session_file}" "${tool_name}"
  done

  echo
}

run_route_case() {
  local task="$1"
  local text="$2"
  local extra=""

  if [[ "${task}" == "vision" ]]; then
    extra="，images_b64=['${VISION_IMAGE_B64}']"
  fi

  run_case \
    "route_${task}" \
    "请调用 omni_route 工具处理这个请求：task=${task}，text='${text}'${extra}。不要解释，只执行工具。" \
    "omni_route"
}

run_guided_case() {
  local task="$1"
  local text="$2"
  local extra=""

  if [[ "${task}" == "vision" ]]; then
    extra="，images_b64=['${VISION_IMAGE_B64}']"
  fi

  run_case \
    "guided_${task}" \
    "请严格按这个流程执行，不要调用 omni_route，也不要在失败后重试第二个模型：1. 先调用 omni_inspect，参数为 task=${task}，text='${text}'${extra}。2. 结合 models、recommended_models 和 hardware，自行选择一个 allowed=true 且 supportsResolvedTask=true 的最终模型。recommended_models 仅供参考，不是强制。3. 调用 omni_run，传入你选定的 model、task=${task}、text='${text}'${extra}。4. 如果 omni_run 返回错误，立即停止，不要再调用任何其他模型。5. 不要解释，只执行工具。" \
    "omni_inspect" \
    "omni_run"
}

openclaw health >/dev/null

case "${MODE}" in
  chat)
    run_route_case "chat" "Reply with exactly CHAT_SMOKE_OK"
    ;;
  vision)
    run_route_case "vision" "Describe this image briefly."
    ;;
  image_generation)
    run_route_case "image_generation" "Draw a minimal red square icon."
    ;;
  guided_chat)
    run_guided_case "chat" "Reply with exactly GUIDED_CHAT_OK"
    ;;
  guided_vision)
    run_guided_case "vision" "Describe this image briefly."
    ;;
  guided_image_generation)
    run_guided_case "image_generation" "Draw a minimal red square icon."
    ;;
  all)
    run_route_case "chat" "Reply with exactly CHAT_SMOKE_OK"
    run_route_case "vision" "Describe this image briefly."
    run_route_case "image_generation" "Draw a minimal red square icon."
    run_guided_case "chat" "Reply with exactly GUIDED_CHAT_OK"
    run_guided_case "vision" "Describe this image briefly."
    run_guided_case "image_generation" "Draw a minimal red square icon."
    ;;
  *)
    echo "Usage: bash scripts/openclaw-smoke-test.sh [chat|vision|image_generation|guided_chat|guided_vision|guided_image_generation|all]" >&2
    exit 1
    ;;
esac
