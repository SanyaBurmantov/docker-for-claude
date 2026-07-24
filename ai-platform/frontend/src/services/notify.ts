/**
 * Notification chime and its mute switch. The tone is synthesised instead of
 * shipping an audio file: no binary in the repo and nothing that can 404.
 */

const STORAGE_KEY = 'notify-sound'

export function isSoundEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
}

let ctx: AudioContext | null = null

function beep(audio: AudioContext, hz: number, at: number, seconds: number): void {
  const osc = audio.createOscillator()
  const gain = audio.createGain()

  osc.type = 'sine'
  osc.frequency.value = hz

  // Ramps instead of a hard start/stop: cutting a sine mid-cycle clicks.
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)

  osc.connect(gain).connect(audio.destination)
  osc.start(at)
  osc.stop(at + seconds + 0.02)
}

/** Two short rising beeps — noticeable across a room, over in a third of a second. */
export function playChime(): void {
  try {
    ctx ??= new AudioContext()
    // A context built before the first user gesture starts suspended; by the time
    // anything here plays the user has clicked in the app, so resuming unblocks it.
    if (ctx.state === 'suspended') void ctx.resume()

    const start = ctx.currentTime
    beep(ctx, 880, start, 0.12)
    beep(ctx, 1320, start + 0.16, 0.18)
  } catch {
    /* no audio device, or a policy blocked it — not worth surfacing an error */
  }
}
