/** Copy to clipboard. Falls back to a hidden-textarea `execCommand` because
 *  `navigator.clipboard` is undefined on non-secure origins — e.g. when the IDE
 *  is opened over http via a LAN IP instead of localhost, which is exactly when
 *  copy "doesn't work". */
export function copyText(text: string) {
  if (!text) return
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => execCopy(text))
    return
  }
  execCopy(text)
}

function execCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    /* clipboard unreachable — nothing else we can do */
  }
  document.body.removeChild(ta)
}
