import { useCallback, useEffect, useRef, useState } from 'react'
import {
  assistVoice,
  fetchVoiceStatus,
  VoiceAssistResult,
  VoiceStatus,
} from '../services/api'
import {
  EMPTY_VOICE_SNAPSHOT,
  publishVoiceSnapshot,
  VoiceHelperSnapshot,
} from '../services/voiceHelperState'
import { useToast } from '../components/Toast'

interface HistoryItem extends VoiceAssistResult {
  id: number
}

const SILENCE_MS = 1_300
const MIN_SEGMENT_MS = 450
const MAX_SEGMENT_MS = 45_000
const MAX_HISTORY = 12

const STAGE_LABEL: Record<VoiceHelperSnapshot['stage'], string> = {
  off: 'Выключен',
  listening: 'Слушаю',
  hearing: 'Слышу речь',
  thinking: 'Готовлю подсказку',
  error: 'Ошибка',
}

function recorderOptions(): MediaRecorderOptions | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
  return mimeType ? { mimeType } : undefined
}

export default function VoiceCoachPage() {
  const [snapshot, setSnapshot] = useState<VoiceHelperSnapshot>(EMPTY_VOICE_SNAPSHOT)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null)
  const [level, setLevel] = useState(0)
  const toast = useToast()

  const snapshotRef = useRef(snapshot)
  const activeRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderStartedAtRef = useRef(0)
  const lastVoiceAtRef = useRef(0)
  const frameRef = useRef(0)
  const queueRef = useRef<Blob[]>([])
  const processingRef = useRef(false)
  const contextRef = useRef<string[]>([])
  const requestRef = useRef<AbortController | null>(null)
  const popupRef = useRef<Window | null>(null)

  const patchSnapshot = useCallback((patch: Partial<VoiceHelperSnapshot>) => {
    setSnapshot((current) => {
      const next = { ...current, ...patch, updatedAt: Date.now() }
      snapshotRef.current = next
      return next
    })
  }, [])

  useEffect(() => publishVoiceSnapshot(snapshot), [snapshot])

  useEffect(() => {
    fetchVoiceStatus().then(setVoiceStatus).catch(() => setVoiceStatus(null))
  }, [])

  const closeOverlay = useCallback(() => {
    if (window.aiDesktop) void window.aiDesktop.hideOverlay()
    else popupRef.current?.close()
    popupRef.current = null
  }, [])

  const openOverlay = useCallback(() => {
    if (window.aiDesktop) {
      void window.aiDesktop.showOverlay()
      return
    }
    popupRef.current = window.open(
      '/vc/overlay',
      'ai-platform-voice-helper',
      'popup=yes,width=560,height=320,resizable=yes'
    )
  }, [])

  const stop = useCallback((hideOverlay = true) => {
    activeRef.current = false
    cancelAnimationFrame(frameRef.current)
    requestRef.current?.abort()
    requestRef.current = null
    queueRef.current = []

    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && recorder.state !== 'inactive') recorder.stop()

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    displayStreamRef.current?.getTracks().forEach((track) => track.stop())
    displayStreamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    processingRef.current = false
    setLevel(0)
    const stopped = { ...snapshotRef.current, active: false, stage: 'off' as const, updatedAt: Date.now() }
    snapshotRef.current = stopped
    setSnapshot(stopped)
    // A route change unmounts this page before its publishing effect can run.
    // Publish synchronously so an already-open overlay never stays "active".
    publishVoiceSnapshot(stopped)
    if (hideOverlay) closeOverlay()
  }, [closeOverlay])

  useEffect(() => () => stop(), [stop])

  async function drainQueue() {
    if (processingRef.current || !activeRef.current) return
    processingRef.current = true

    while (activeRef.current && queueRef.current.length > 0) {
      const audio = queueRef.current.shift()!
      patchSnapshot({ stage: 'thinking', error: '' })

      const controller = new AbortController()
      requestRef.current = controller
      try {
        const result = await assistVoice(audio, contextRef.current.join('\n'), controller.signal)
        if (!activeRef.current) break

        if (result.transcript) {
          contextRef.current = [...contextRef.current, result.transcript].slice(-8)
          setHistory((current) => [{ ...result, id: Date.now() }, ...current].slice(0, MAX_HISTORY))
        }

        patchSnapshot({
          transcript: result.transcript,
          question: result.answer ? result.question : snapshotRef.current.question,
          answer: result.answer || snapshotRef.current.answer,
          error: '',
        })
      } catch (err) {
        if (!controller.signal.aborted) {
          patchSnapshot({ stage: 'error', error: (err as Error).message })
        }
      } finally {
        if (requestRef.current === controller) requestRef.current = null
      }
    }

    processingRef.current = false
    if (activeRef.current) {
      patchSnapshot({ stage: recorderRef.current ? 'hearing' : 'listening' })
    }
  }

  function startSegment(stream: MediaStream) {
    if (!activeRef.current || recorderRef.current) return

    const recorder = new MediaRecorder(stream, recorderOptions())
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onerror = () => {
      patchSnapshot({ stage: 'error', error: 'Не удалось записать аудио' })
    }
    recorder.onstop = () => {
      if (recorderRef.current === recorder) recorderRef.current = null
      const duration = performance.now() - recorderStartedAtRef.current
      if (!activeRef.current || duration < MIN_SEGMENT_MS || chunks.length === 0) return

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      if (blob.size > 500) {
        queueRef.current.push(blob)
        void drainQueue()
      }
    }
    recorderStartedAtRef.current = performance.now()
    lastVoiceAtRef.current = recorderStartedAtRef.current
    recorderRef.current = recorder
    recorder.start(250)
    patchSnapshot({ stage: 'hearing', error: '' })
  }

  function watchLevel(analyser: AnalyserNode, stream: MediaStream, source: VoiceHelperSnapshot['source']) {
    const values = new Float32Array(analyser.fftSize)
    const threshold = source === 'system' ? 0.008 : 0.018
    let lastLevelPaint = 0

    const frame = () => {
      if (!activeRef.current) return
      analyser.getFloatTimeDomainData(values)
      let energy = 0
      for (const value of values) energy += value * value
      const rms = Math.sqrt(energy / values.length)
      const now = performance.now()

      if (now - lastLevelPaint > 80) {
        setLevel(Math.min(100, Math.round((rms / threshold) * 45)))
        lastLevelPaint = now
      }

      if (rms >= threshold) {
        lastVoiceAtRef.current = now
        startSegment(stream)
      }

      const recorder = recorderRef.current
      if (recorder && recorder.state === 'recording') {
        const duration = now - recorderStartedAtRef.current
        if ((duration >= MIN_SEGMENT_MS && now - lastVoiceAtRef.current >= SILENCE_MS) || duration >= MAX_SEGMENT_MS) {
          recorder.stop()
        }
      }

      frameRef.current = requestAnimationFrame(frame)
    }
    frameRef.current = requestAnimationFrame(frame)
  }

  async function capture(source: VoiceHelperSnapshot['source']): Promise<MediaStream> {
    if (!navigator.mediaDevices) throw new Error('Захват звука недоступен в этом окне')

    if (source === 'system') {
      if (window.aiDesktop?.platform === 'linux') {
        // Electron's built-in loopback is Windows-only. PulseAudio and PipeWire
        // expose sink monitors as regular input devices, so use one directly.
        let devices = await navigator.mediaDevices.enumerateDevices()
        if (!devices.some((device) => device.label)) {
          const permission = await navigator.mediaDevices.getUserMedia({ audio: true })
          permission.getTracks().forEach((track) => track.stop())
          devices = await navigator.mediaDevices.enumerateDevices()
        }
        const monitor = devices.find((device) => (
          device.kind === 'audioinput' && /monitor|монитор|loopback|stereo mix|стерео микшер/i.test(device.label)
        ))
        if (!monitor) {
          throw new Error(
            'Linux не опубликовал monitor-source. Включите Monitor of … в PulseAudio/PipeWire или используйте Microphone.'
          )
        }
        return navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: monitor.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
      }

      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Системный звук не поддерживается. Запустите desktop-приложение.')
      }
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const audioTracks = display.getAudioTracks()
      if (audioTracks.length === 0) {
        display.getTracks().forEach((track) => track.stop())
        throw new Error('Источник не отдал звук. Выберите экран/вкладку с передачей аудио.')
      }
      // Chromium couples loopback audio to a display capture. Keep its video
      // track alive but disabled; stopping it can also end audio on some hosts.
      display.getVideoTracks().forEach((track) => { track.enabled = false })
      displayStreamRef.current = display
      return new MediaStream(audioTracks)
    }

    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  }

  async function start() {
    if (!voiceStatus?.configured) {
      toast('error', 'GEMINI_API_KEY не задан — Voice Helper не настроен')
      return
    }

    openOverlay()
    activeRef.current = true
    patchSnapshot({ active: true, stage: 'listening', error: '' })

    try {
      const stream = await capture(snapshot.source)
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        displayStreamRef.current?.getTracks().forEach((track) => track.stop())
        displayStreamRef.current = null
        return
      }
      streamRef.current = stream
      stream.getAudioTracks()[0].onended = () => stop()

      const audioContext = new AudioContext()
      await audioContext.resume()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.65
      audioContext.createMediaStreamSource(stream).connect(analyser)
      audioContextRef.current = audioContext
      watchLevel(analyser, stream, snapshot.source)
    } catch (err) {
      if (!activeRef.current) return
      activeRef.current = false
      patchSnapshot({ active: false, stage: 'error', error: (err as Error).message })
      toast('error', (err as Error).message)
    }
  }

  function clear() {
    contextRef.current = []
    setHistory([])
    patchSnapshot({ transcript: '', question: '', answer: '', error: '' })
  }

  const configured = Boolean(voiceStatus?.configured)

  return (
    <div className="voice-coach-page">
      <header className="voice-coach-hero">
        <div>
          <div className="voice-eyebrow">LIVE CONVERSATION COPILOT</div>
          <h1>Voice Helper</h1>
          <p>Слушает разговор и показывает короткий английский ответ, который можно сразу произнести.</p>
        </div>
        <div className={`voice-state voice-state-${snapshot.stage}`}>
          <span className="voice-state-dot" />
          {STAGE_LABEL[snapshot.stage]}
        </div>
      </header>

      {!window.aiDesktop && (
        <div className="voice-notice">
          В браузере подсказка откроется отдельным popup-окном. Режим поверх других программ и захват
          системного звука надёжнее работают в desktop-приложении.
        </div>
      )}

      {voiceStatus && !configured && (
        <div className="error">GEMINI_API_KEY не задан в .env — распознавание и ответы недоступны.</div>
      )}

      <section className="voice-control-panel">
        <label className="voice-source-field">
          <span>Источник звука</span>
          <select
            value={snapshot.source}
            disabled={snapshot.active}
            onChange={(event) => patchSnapshot({ source: event.target.value as VoiceHelperSnapshot['source'] })}
          >
            <option value="microphone">Microphone</option>
            <option value="system">System audio</option>
          </select>
        </label>

        <button
          className={`voice-help-button ${snapshot.active ? 'voice-help-button-active' : ''}`}
          onClick={() => (snapshot.active ? stop() : void start())}
          disabled={voiceStatus === null || (!configured && !snapshot.active)}
        >
          <span className="voice-help-icon">{snapshot.active ? '■' : '?'}</span>
          <span>{snapshot.active ? 'STOP' : 'HELP'}</span>
        </button>

        <div className="voice-meter" aria-label={`Уровень звука ${level}%`}>
          <div className="voice-meter-fill" style={{ width: `${level}%` }} />
        </div>

        <div className="voice-control-actions">
          <button className="btn btn-secondary btn-sm" onClick={openOverlay}>Открыть окно подсказки</button>
          <button className="btn btn-secondary btn-sm" onClick={clear} disabled={!history.length}>Очистить</button>
        </div>
      </section>

      {snapshot.error && <div className="error voice-error">{snapshot.error}</div>}

      <section className="voice-current">
        <div className="voice-current-label">Текущая подсказка</div>
        {snapshot.answer ? (
          <>
            <div className="voice-question">{snapshot.question}</div>
            <div className="voice-answer">{snapshot.answer}</div>
          </>
        ) : (
          <div className="voice-placeholder">
            Нажмите Help и начните разговор. После вопроса здесь появится готовый ответ на английском.
          </div>
        )}
      </section>

      <section className="voice-history">
        <h2>История</h2>
        {history.length === 0 ? (
          <div className="voice-placeholder">Распознанные фрагменты появятся здесь.</div>
        ) : history.map((item) => (
          <article className="voice-history-item" key={item.id}>
            <div className="voice-transcript">{item.transcript}</div>
            {item.answer && <div className="voice-history-answer">→ {item.answer}</div>}
          </article>
        ))}
      </section>
    </div>
  )
}
