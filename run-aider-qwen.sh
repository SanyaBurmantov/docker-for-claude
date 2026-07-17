#!/usr/bin/env bash
set -euo pipefail

export ANTHROPIC_API_KEY="sk-ws-H.XHIHEL.UCgD.MEYCIQCK-QzMni3OF_RRjmOzCyd2FKdk8Hvbd212KZCbqqMHuwIhAIL1Nij2rJBEVeebdVEftWFheZqs13txl4zQKHMzHrep"
export ANTHROPIC_API_BASE="https://dashscope-intl.aliyuncs.com/apps/anthropic"

aider --model anthropic/qwen-max "$@"
