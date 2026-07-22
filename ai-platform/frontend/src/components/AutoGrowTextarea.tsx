import { useLayoutEffect, useRef, TextareaHTMLAttributes } from 'react'

/**
 * Textarea that starts one row tall and grows to fit its content. Resizes on
 * every value change, so it works whether the text is typed or set programmatically
 * (generated commit message, streamed daylog).
 */
export default function AutoGrowTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [props.value])

  return <textarea ref={ref} rows={1} {...props} />
}
