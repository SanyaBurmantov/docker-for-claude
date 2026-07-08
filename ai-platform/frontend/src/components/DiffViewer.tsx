import { DiffEditor } from '@monaco-editor/react'

interface DiffViewerProps {
  original: string
  modified: string
  language?: string
}

export default function DiffViewer({ original, modified, language = 'plaintext' }: DiffViewerProps) {
  if (!original && !modified) {
    return <div className="no-changes">No changes detected</div>
  }

  return (
    <div className="diff-container">
      <DiffEditor
        original={original}
        modified={modified}
        language={language}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
        } as any}
        height="100%"
      />
    </div>
  )
}
