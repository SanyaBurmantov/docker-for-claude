import { ReactNode, useEffect } from 'react'
import { DrawerState } from '../hooks/useDrawer'

interface DrawerProps {
  /** From `useDrawer` — the caller owns it because its content usually needs `open` too. */
  drawer: DrawerState
  label: string
  /** Letter of the Ctrl+Shift+… shortcut that toggles the panel. */
  hotkey: string
  /** Right edge instead of the left one. */
  side?: 'left' | 'right'
  headerActions?: ReactNode
  /** Return true if Escape belongs to something else (a lightbox) and the panel should stay open. */
  onEscape?: () => boolean
  children: ReactNode
}

/**
 * The slide-out panel every drawer shares: a tab on the screen edge, a scrim and a
 * titled panel. The accent colour and the tab's slot come from the `drawer-<id>`
 * class; what goes inside is the caller's business.
 */
export default function Drawer({
  drawer: { id, open, close, toggle },
  label,
  hotkey,
  side = 'left',
  headerActions,
  onEscape,
  children,
}: DrawerProps) {
  // The shortcut works from anywhere, including inside the terminal. Rebound every
  // render instead of tracking deps — the handler reads `open` and `onEscape`.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open && !onEscape?.()) close()
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === hotkey) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mods = `drawer-${id} drawer-${side}`

  return (
    <>
      <button
        className={`drawer-tab ${mods} ${open ? 'drawer-tab-open' : ''}`}
        onClick={toggle}
        title={`${label} (Ctrl+Shift+${hotkey.toUpperCase()})`}
        aria-label={`Toggle ${label} panel`}
      >
        <span className="drawer-tab-label">{label}</span>
      </button>

      {open && <div className="drawer-scrim" onClick={close} />}

      <aside className={`drawer ${mods} ${open ? 'drawer-open' : ''}`} aria-hidden={!open}>
        <header className="drawer-header">
          <h3>{label}</h3>
          <div className="drawer-header-actions">
            {headerActions}
            <button className="drawer-icon-btn" onClick={close} aria-label="Close">
              ×
            </button>
          </div>
        </header>
        {children}
      </aside>
    </>
  )
}
