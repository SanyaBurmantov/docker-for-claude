import { useEffect, useState } from 'react'
import {
  readVoiceSnapshot,
  subscribeVoiceSnapshot,
  VoiceHelperSnapshot,
} from '../services/voiceHelperState'
import { useLanguage } from '../i18n'

export default function VoiceHelperOverlay() {
  const [snapshot, setSnapshot] = useState(readVoiceSnapshot)
  const { t } = useLanguage()

  useEffect(() => {
    document.body.classList.add('voice-overlay-body')
    const unsubscribe = subscribeVoiceSnapshot(setSnapshot)
    return () => {
      document.body.classList.remove('voice-overlay-body')
      unsubscribe()
    }
  }, [])

  function close() {
    if (window.aiDesktop) void window.aiDesktop.hideOverlay()
    else window.close()
  }

  return (
    <div className={`voice-overlay voice-overlay-${snapshot.stage}`}>
      <header className="voice-overlay-header">
        <div className="voice-overlay-status">
          <span className="voice-state-dot" />
          {t(`voice.overlay${snapshot.stage[0].toUpperCase()}${snapshot.stage.slice(1)}`)}
        </div>
        <button onClick={close} aria-label={t('common.close')}>×</button>
      </header>
      <main className="voice-overlay-content">
        {snapshot.error ? (
          <div className="voice-overlay-error">{snapshot.error}</div>
        ) : snapshot.answer ? (
          <>
            <div className="voice-overlay-question">{snapshot.question}</div>
            <div className="voice-overlay-answer">{snapshot.answer}</div>
          </>
        ) : (
          <div className="voice-overlay-empty">
            {snapshot.active ? t('voice.overlayActiveEmpty') : t('voice.overlayInactiveEmpty')}
          </div>
        )}
      </main>
    </div>
  )
}
