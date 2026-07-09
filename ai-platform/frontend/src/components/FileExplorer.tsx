import { useState, useEffect, useCallback, useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { fetchFiles, fetchFileContent, saveFileContent, fsAction, uploadFiles, FileItem } from '../services/api'
import Modal, { ConfirmDialog } from './Modal'
import { useToast } from './Toast'

interface FileExplorerProps {
  projectId: string
}

interface Selection {
  path: string
  type: 'file' | 'directory'
}

type NameAction = 'create-file' | 'mkdir' | 'rename'

function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

export default function FileExplorer({ projectId }: FileExplorerProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nameAction, setNameAction] = useState<NameAction | null>(null)
  const [nameValue, setNameValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  // Refs keep the save handler (bound once inside Monaco) pointed at fresh state
  const stateRef = useRef({ path: null as string | null, content: '', dirty: false, saving: false })
  stateRef.current = {
    path: selected?.type === 'file' ? selected.path : null,
    content: fileContent,
    dirty,
    saving,
  }

  const loadFiles = useCallback(() => {
    setLoading(true)
    fetchFiles(projectId)
      .then(setFiles)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const loadFile = useCallback(async (path: string) => {
    if (stateRef.current.dirty && !window.confirm('Discard unsaved changes?')) return
    setSelected({ path, type: 'file' })
    setDirty(false)
    try {
      const content = await fetchFileContent(projectId, path)
      setFileContent(content)
    } catch {
      setFileContent('// Error loading file content')
    }
  }, [projectId])

  const handleSave = useCallback(async () => {
    const { path, content, dirty: isDirty, saving: isSaving } = stateRef.current
    if (!path || !isDirty || isSaving) return
    setSaving(true)
    try {
      await saveFileContent(projectId, path, content)
      setDirty(false)
      toast('success', `Saved ${path}`)
    } catch (e) {
      toast('error', `Save failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }, [projectId, toast])

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave()
    })
  }, [handleSave])

  // New files/folders land in the selected directory (or the parent of the selected file)
  function targetDir(): string {
    if (!selected) return ''
    return selected.type === 'directory' ? selected.path : parentDir(selected.path)
  }

  function openNameModal(action: NameAction) {
    if (action === 'rename') {
      if (!selected) return
      setNameValue(selected.path.split('/').pop() ?? '')
    } else {
      setNameValue('')
    }
    setNameAction(action)
  }

  async function handleNameSubmit() {
    const name = nameValue.trim()
    if (!name || !nameAction) return
    if (name.includes('/') || name.includes('..')) {
      toast('error', 'Invalid name')
      return
    }
    try {
      if (nameAction === 'rename' && selected) {
        const newPath = parentDir(selected.path) ? `${parentDir(selected.path)}/${name}` : name
        await fsAction(projectId, 'rename', selected.path, newPath)
        toast('success', `Renamed to ${newPath}`)
        setSelected({ ...selected, path: newPath })
      } else {
        const base = targetDir()
        const relPath = base ? `${base}/${name}` : name
        await fsAction(projectId, nameAction, relPath)
        toast('success', nameAction === 'mkdir' ? `Folder ${relPath} created` : `File ${relPath} created`)
        if (nameAction === 'create-file') {
          await loadFile(relPath)
        }
        if (base) setExpandedPaths((prev) => new Set(prev).add(base))
      }
      setNameAction(null)
      loadFiles()
    } catch (e) {
      toast('error', `Failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleDelete() {
    if (!selected) return
    setConfirmDelete(false)
    try {
      await fsAction(projectId, 'delete', selected.path)
      toast('success', `Deleted ${selected.path}`)
      setSelected(null)
      setFileContent('')
      setDirty(false)
      loadFiles()
    } catch (e) {
      toast('error', `Delete failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const dir = targetDir()
    try {
      await uploadFiles(projectId, dir, Array.from(fileList))
      toast('success', `Uploaded ${fileList.length} file(s)${dir ? ` to ${dir}` : ''}`)
      loadFiles()
    } catch (e) {
      toast('error', `Upload failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

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
          className={`file-tree-item ${selected?.path === item.path ? 'selected' : ''}`}
          style={{ paddingLeft: `${8 + depth * 20}px` }}
          onClick={() => {
            if (item.type === 'directory') {
              toggleExpand(item.path)
              setSelected({ path: item.path, type: 'directory' })
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

  const selectedFile = selected?.type === 'file' ? selected.path : null
  const language = selectedFile ? (languageMap[getFileExtension(selectedFile)] ?? 'plaintext') : 'plaintext'

  if (loading && files.length === 0) {
    return <div className="loading">Loading files...</div>
  }

  return (
    <div className="file-explorer">
      <div
        className={`file-tree ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleUpload(e.dataTransfer.files)
        }}
      >
        <div className="file-tree-toolbar">
          <button className="icon-btn" title="New file" onClick={() => openNameModal('create-file')}>📄＋</button>
          <button className="icon-btn" title="New folder" onClick={() => openNameModal('mkdir')}>📁＋</button>
          <button className="icon-btn" title="Rename selected" onClick={() => openNameModal('rename')} disabled={!selected}>✏️</button>
          <button className="icon-btn" title="Delete selected" onClick={() => setConfirmDelete(true)} disabled={!selected}>🗑</button>
          <button className="icon-btn" title="Upload files (or drag & drop)" onClick={() => uploadInputRef.current?.click()}>⬆</button>
          <button className="icon-btn" title="Refresh" onClick={loadFiles}>⟳</button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              handleUpload(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        {files.length === 0 ? (
          <div className="file-tree-item muted">No files — drop some here</div>
        ) : (
          renderTree(files)
        )}
      </div>
      <div className="file-editor">
        {selectedFile ? (
          <>
            <div className="file-editor-header">
              <span className="file-editor-path">
                {selectedFile}
                {dirty && <span className="file-dirty" title="Unsaved changes"> ●</span>}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? 'Saving…' : 'Save (Ctrl+S)'}
              </button>
            </div>
            <div className="file-editor-body">
              <Editor
                value={fileContent}
                language={language}
                theme="vs-dark"
                onMount={handleEditorMount}
                onChange={(value) => {
                  setFileContent(value ?? '')
                  setDirty(true)
                }}
                options={{
                  readOnly: false,
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </>
        ) : (
          <div className="editor-placeholder">
            <span style={{ fontSize: '2rem' }}>📄</span>
            <span>Select a file to view its contents</span>
          </div>
        )}
      </div>

      {nameAction && (
        <Modal
          title={nameAction === 'rename' ? 'Rename' : nameAction === 'mkdir' ? 'New folder' : 'New file'}
          onClose={() => setNameAction(null)}
        >
          {nameAction !== 'rename' && (
            <p className="modal-hint">
              In: /{targetDir() || ''}
            </p>
          )}
          <div className="form-field">
            <label>Name</label>
            <input
              type="text"
              value={nameValue}
              autoFocus
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setNameAction(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleNameSubmit}>OK</button>
          </div>
        </Modal>
      )}

      {confirmDelete && selected && (
        <ConfirmDialog
          title="Delete"
          message={`Delete "${selected.path}"${selected.type === 'directory' ? ' and everything inside' : ''}?`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
