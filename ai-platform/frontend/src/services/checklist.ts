/**
 * A checklist (TASKS.md, FIXES.md) is a plain markdown file that Claude also
 * reads, so every edit here rewrites only the checkbox lines and leaves the rest
 * of the file exactly as the author wrote it.
 */

export interface Task {
  line: number
  done: boolean
  text: string
}

export const TASK_RE = /^- \[([ xX])\] (.*)$/

export function parseTasks(lines: string[]): Task[] {
  const tasks: Task[] = []
  lines.forEach((raw, line) => {
    const match = raw.match(TASK_RE)
    if (match) tasks.push({ line, done: match[1] !== ' ', text: match[2].trim() })
  })
  return tasks
}

/** `heading` is only used when the file has to be created from scratch. */
export function withTaskAdded(lines: string[], text: string, heading = 'Tasks'): string[] {
  const entry = `- [ ] ${text}`
  const next = [...lines]

  let lastTask = -1
  next.forEach((raw, i) => {
    if (TASK_RE.test(raw)) lastTask = i
  })

  if (lastTask >= 0) {
    next.splice(lastTask + 1, 0, entry)
    return next
  }

  if (next.every((raw) => !raw.trim())) return [`# ${heading}`, '', entry]

  while (next.length > 0 && !next[next.length - 1].trim()) next.pop()
  return [...next, '', entry]
}

export function withTasksAdded(lines: string[], texts: string[], heading = 'Tasks'): string[] {
  return texts.reduce((acc, text) => withTaskAdded(acc, text, heading), lines)
}

export function withTaskToggled(lines: string[], task: Task): string[] {
  const next = [...lines]
  next[task.line] = `- [${task.done ? ' ' : 'x'}] ${task.text}`
  return next
}

export function withTaskRemoved(lines: string[], task: Task): string[] {
  const next = [...lines]
  next.splice(task.line, 1)
  return next
}

export function serialize(lines: string[]): string {
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}
