interface DiffViewerProps {
  diff: string
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff-line diff-file'
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'diff-line diff-meta'
  if (line.startsWith('@@')) return 'diff-line diff-hunk'
  if (line.startsWith('+')) return 'diff-line diff-add'
  if (line.startsWith('-')) return 'diff-line diff-del'
  return 'diff-line'
}

export default function DiffViewer({ diff }: DiffViewerProps) {
  if (!diff.trim()) {
    return <div className="no-changes">No changes detected</div>
  }

  return (
    <div className="diff-container">
      <pre className="diff-view">
        {diff.split('\n').map((line, i) => (
          <div key={i} className={lineClass(line)}>
            {line || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}
