import { useState } from 'react'
import { isSoundEnabled, setSoundEnabled, playChime } from '../services/notify'

/**
 * Mute switch for the notification chime. The setting lives in localStorage and is
 * read at play time, so no context is needed to reach the one place that uses it.
 */
export default function SoundToggle() {
  const [enabled, setEnabled] = useState(isSoundEnabled)

  function toggle() {
    const next = !enabled
    setSoundEnabled(next)
    setEnabled(next)
    // Switching it on plays the chime once: confirms the volume, and the click
    // itself is the user gesture browsers want before they allow audio.
    if (next) playChime()
  }

  return (
    <button
      className="nav-link"
      onClick={toggle}
      title={enabled ? 'Звук уведомлений включён' : 'Звук уведомлений выключен'}
    >
      {enabled ? '🔔' : '🔕'}
    </button>
  )
}
