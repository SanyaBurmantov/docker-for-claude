import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { fetchFiles, fetchFileContent, FileItem } from '../services/api'

interface FileExplorerProps {
  projectId: string
}

export default function FileExplorer({ projectId }: FileExplorerProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchFiles(projectId)
      .then(setFiles)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const loadFile = useCallback(async (path: string) => {
    setSelectedPath(path)
    try {
      const content = await fetchFileContent(projectId, path)
      setFileContent(content)
    } catch {
      setFileContent('// Error loading file content')
    }
  }, [projectId])

  function toggleExpand(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function renderTree(items: FileItem[], depth = 0): React.ReactNode {
    return items.map((item) => (
      <div key={item.path}>
        <div
          className={`file-tree-item ${selectedPath === item.path ? 'selected' : ''}`}
          style={{ paddingLeft: `${8 + depth * 20}px` }}
          onClick={() => {
            if (item.type === 'directory') {
              toggleExpand(item.path)
            } else {
              loadFile(item.path)
            }
          }}
        >
          <span className="icon">
            {item.type === 'directory'
              ? expandedPaths.has(item.path) ? '📂' : '📁'
              : '📄'
            }
          </span>
          <span>{item.name}</span>
        </div>
        {item.type === 'directory' && expandedPaths.has(item.path) && item.children && (
          <div className="file-tree-children">
            {renderTree(item.children, depth + 1)}
          </div>
        )}
      </div>
    ))
  }

  function getFileExtension(path: string): string {
    const parts = path.split('.')
    return parts.length > 1 ? parts[parts.length - 1] : 'plaintext'
  }

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    html: 'html',
    css: 'css',
    scss: 'scss',
    py: 'python',
    rs: 'rust',
    go: 'go',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'shell',
    bash: 'shell',
    dockerfile: 'dockerfile',
    sql: 'sql',
    xml: 'xml',
  }

  const language = selectedPath ? (languageMap[getFileExtension(selectedPath)] ?? 'plaintext') : 'plaintext'

  if (loading) {
    return <div className="loading">Loading files...</div>
  }

  return (
    <div className="file-explorer">
      <div className="file-tree">
        {files.length === 0 ? (
          <div className="file-tree-item" style={{ color: '#666' }}>No files</div>
        ) : (
          renderTree(files)
        )}
      </div>
      <div className="file-editor">
        {selectedPath ? (
          <Editor
            value={fileContent}
            language={language}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        ) : (
          <div className="editor-placeholder">
            <span style={{ fontSize: '2rem' }}>📄</span>
            <span>Select a file to view its contents</span>
          </div>
        )}
      </div>
    </div>
  )
}
