import { useEffect, useState } from 'react'

const OPENED = 'drawer-opened'

/**
 * Open state for a slide-out drawer, exclusive across all of them: the panels share
 * the same edges of the screen, so opening one closes whichever was open before.
 */
export function useDrawer(id: string) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onOtherOpened(e: Event) {
      if ((e as CustomEvent<string>).detail !== id) setOpen(false)
    }
    window.addEventListener(OPENED, onOtherOpened)
    return () => window.removeEventListener(OPENED, onOtherOpened)
  }, [id])

  function set(next: boolean) {
    setOpen(next)
    if (next) window.dispatchEvent(new CustomEvent(OPENED, { detail: id }))
  }

  return {
    open,
    close: () => set(false),
    toggle: () => set(!open),
  }
}
