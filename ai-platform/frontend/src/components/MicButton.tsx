import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react'
import { transcribeAudio } from '../services/api'
import { useToast } from './Toast'

/** The usual destination for dictation: appended to whatever is already in a field. */
export function appendTo(setText: Dispatch<SetStateAction<string>>) {
  return (text: string) => setText((v) => (v ? `${v} ${text}` : text))
}

interface Props {
  /** Gets the recognised text; the caller decides where to put it. */
  onText: (text: string) => void
  disabled?: boolean
  title?: string
}

type State = 'idle' | 'recording' | 'working'

/**
 * Click to record, click again to stop — the recording goes to Gemini and comes
 * back as text. The mic needs a secure context, so over plain http it only works
 * on localhost; anywhere else the browser hides `mediaDevices` and we say so
 * instead of failing silently.
 */
export default function MicButton({ onText, disabled, title }: Props) {
  const [state, setState] = useState<State>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const toast = useToast()

  // A recording left running would keep the tab's mic indicator on for good.
  useEffect(() => () => recorderRef.current?.stream.getTracks().forEach((t) => t.stop()), [])

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('error', 'Микрофон доступен только на localhost или по https')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      toast('error', `Микрофон недоступен: ${(err as Error).message}`)
      return
    }

    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      recorderRef.current = null
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      if (!blob.size) {
        setState('idle')
        return
      }

      setState('working')
      try {
        const text = await transcribeAudio(blob)
        if (text) onText(text)
        else toast('error', 'Ничего не расслышал')
      } catch (err) {
        toast('error', (err as Error).message)
      } finally {
        setState('idle')
      }
    }

    recorderRef.current = recorder
    recorder.start()
    setState('recording')
  }

  function click() {
    if (state === 'recording') recorderRef.current?.stop()
    else if (state === 'idle') start()
  }

  return (
    <button
      className={`mic-btn ${state === 'recording' ? 'mic-btn-live' : ''}`}
      onClick={click}
      disabled={disabled || state === 'working'}
      title={state === 'recording' ? 'Остановить и распознать' : title || 'Надиктовать'}
      aria-label="Голосовой ввод"
    >
      {state === 'working' ? '…' : state === 'recording' ? '■' : '🎤'}
    </button>
  )
}
