export type VoiceHelperStage = 'off' | 'listening' | 'hearing' | 'thinking' | 'error'

export interface VoiceHelperSnapshot {
  active: boolean
  stage: VoiceHelperStage
  source: 'microphone' | 'system'
  transcript: string
  question: string
  answer: string
  error: string
  updatedAt: number
}

const STORAGE_KEY = 'ai-platform:voice-helper'
const CHANNEL_NAME = 'ai-platform:voice-helper'

export const EMPTY_VOICE_SNAPSHOT: VoiceHelperSnapshot = {
  active: false,
  stage: 'off',
  source: 'microphone',
  transcript: '',
  question: '',
  answer: '',
  error: '',
  updatedAt: 0,
}

export function readVoiceSnapshot(): VoiceHelperSnapshot {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '') as Partial<VoiceHelperSnapshot>
    return { ...EMPTY_VOICE_SNAPSHOT, ...value }
  } catch {
    return EMPTY_VOICE_SNAPSHOT
  }
}

/** Keeps the full VC page and the small desktop overlay in sync. */
export function publishVoiceSnapshot(snapshot: VoiceHelperSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage(snapshot)
    channel.close()
  }
}

export function subscribeVoiceSnapshot(listener: (snapshot: VoiceHelperSnapshot) => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener(readVoiceSnapshot())
  }
  window.addEventListener('storage', storage)

  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null
  if (channel) channel.onmessage = (event) => listener(event.data as VoiceHelperSnapshot)

  return () => {
    window.removeEventListener('storage', storage)
    channel?.close()
  }
}
