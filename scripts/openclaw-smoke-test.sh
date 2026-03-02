#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-all}"
AGENT_ID="${OPENCLAW_AGENT_ID:-main}"

VISION_IMAGE_B64="iVBORw0KGgoAAAANSUhEUgAAABEAAAARCAMAAAAMs7fIAAAAjVBMVEX///9tbUl2dmJtgFt4eFpzd1lyeFhzd1pzeFlzellzeVlzd1lzeFp0eFpyeVlzeVlzd1pyeVp0eFpzeFl0eVp2e1x2e113fF54fWCEiG2Lj3WUmICvsqGztqW4uqq9v7C/wbPBw7XCxLbExrnKzMDR08jR08nS1MrT1cvU1czX2M/a3NPb3NT8/Pv///8B7noCAAAAE3RSTlMABw0OEZKTlJWV8fLy8vPz9PX1HYf5oAAAAIdJREFUeNpl0MUBwzAMQFGFmbHM3Gr/8ZrEbP+b38WSYM5lwZIVFUlMSorQmiSsG1HlT5I1chmAXYrnumlKG5ycw/G3aXJHkgO+Byqr6zjBCV99Q2WLn7E943MCKs0evxd8dI2QZod4n0DIRLcJqNB5WgLTPPrMKQAElQS1N4kVSrsHFpj3+QOaLRG3Nf1QIAAAAABJRU5ErkJggg=="

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
    "请严格按这个流程执行，不要调用 omni_route：1. 先调用 omni_inspect，参数为 task=${task}，text='${text}'${extra}。2. 从 recommended_models 里选择第一个模型；如果 recommended_models 为空，就从 models 里选择第一个 allowed=true 且 supportsResolvedTask=true 的模型。3. 调用 omni_run，传入你选中的 model、task=${task}、text='${text}'${extra}。4. 不要解释，只执行工具。" \
    "omni_inspect" \
    "omni_run"
}

openclaw health >/dev/null

case "${MODE}" in
  chat)
    run_route_case "chat" "hello from OpenClaw chat smoke test"
    ;;
  vision)
    run_route_case "vision" "Describe this image briefly."
    ;;
  image_generation)
    run_route_case "image_generation" "Draw a minimal red square icon."
    ;;
  guided_chat)
    run_guided_case "chat" "hello from OpenClaw guided chat smoke test"
    ;;
  guided_vision)
    run_guided_case "vision" "Describe this image briefly."
    ;;
  guided_image_generation)
    run_guided_case "image_generation" "Draw a minimal red square icon."
    ;;
  all)
    run_route_case "chat" "hello from OpenClaw chat smoke test"
    run_route_case "vision" "Describe this image briefly."
    run_route_case "image_generation" "Draw a minimal red square icon."
    run_guided_case "chat" "hello from OpenClaw guided chat smoke test"
    run_guided_case "vision" "Describe this image briefly."
    run_guided_case "image_generation" "Draw a minimal red square icon."
    ;;
  *)
    echo "Usage: bash scripts/openclaw-smoke-test.sh [chat|vision|image_generation|guided_chat|guided_vision|guided_image_generation|all]" >&2
    exit 1
    ;;
esac
