import { useState, useEffect, useCallback, useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { fetchFiles, fetchFileContent, saveFileContent, fsAction, uploadFiles, FileItem } from '../services/api'
import Modal, { ConfirmDialog } from './Modal'
import { useToast } from './Toast'
import { useLanguage } from '../i18n'

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
  const { t } = useLanguage()

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
    if (stateRef.current.dirty && !window.confirm(t('files.discard'))) return
    setSelected({ path, type: 'file' })
    setDirty(false)
    try {
      const content = await fetchFileContent(projectId, path)
      setFileContent(content)
    } catch {
      setFileContent(t('files.loadError'))
    }
  }, [projectId, t])

  const handleSave = useCallback(async () => {
    const { path, content, dirty: isDirty, saving: isSaving } = stateRef.current
    if (!path || !isDirty || isSaving) return
    setSaving(true)
    try {
      await saveFileContent(projectId, path, content)
      setDirty(false)
      toast('success', t('files.saved', { path }))
    } catch (e) {
      toast('error', t('files.saveFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setSaving(false)
    }
  }, [projectId, t, toast])

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
      toast('error', t('files.invalidName'))
      return
    }
    try {
      if (nameAction === 'rename' && selected) {
        const newPath = parentDir(selected.path) ? `${parentDir(selected.path)}/${name}` : name
        await fsAction(projectId, 'rename', selected.path, newPath)
        toast('success', t('files.renamed', { path: newPath }))
        setSelected({ ...selected, path: newPath })
      } else {
        const base = targetDir()
        const relPath = base ? `${base}/${name}` : name
        await fsAction(projectId, nameAction, relPath)
        toast('success', t(nameAction === 'mkdir' ? 'files.folderCreated' : 'files.fileCreated', { path: relPath }))
        if (nameAction === 'create-file') {
          await loadFile(relPath)
        }
        if (base) setExpandedPaths((prev) => new Set(prev).add(base))
      }
      setNameAction(null)
      loadFiles()
    } catch (e) {
      toast('error', t('files.actionFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleDelete() {
    if (!selected) return
    setConfirmDelete(false)
    try {
      await fsAction(projectId, 'delete', selected.path)
      toast('success', t('files.deleted', { path: selected.path }))
      setSelected(null)
      setFileContent('')
      setDirty(false)
      loadFiles()
    } catch (e) {
      toast('error', t('files.deleteFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const dir = targetDir()
    try {
      await uploadFiles(projectId, dir, Array.from(fileList))
      toast('success', t('files.uploaded', {
        count: fileList.length,
        destination: dir ? t('files.toDestination', { path: dir }) : '',
      }))
      loadFiles()
    } catch (e) {
      toast('error', t('files.uploadFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
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
  const editorLanguage = selectedFile ? (languageMap[getFileExtension(selectedFile)] ?? 'plaintext') : 'plaintext'

  if (loading && files.length === 0) {
    return <div className="loading">{t('files.loading')}</div>
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
          <button className="icon-btn" title={t('files.newFile')} onClick={() => openNameModal('create-file')}>📄＋</button>
          <button className="icon-btn" title={t('files.newFolder')} onClick={() => openNameModal('mkdir')}>📁＋</button>
          <button className="icon-btn" title={t('files.renameSelected')} onClick={() => openNameModal('rename')} disabled={!selected}>✏️</button>
          <button className="icon-btn" title={t('files.deleteSelected')} onClick={() => setConfirmDelete(true)} disabled={!selected}>🗑</button>
          <button className="icon-btn" title={t('files.upload')} onClick={() => uploadInputRef.current?.click()}>⬆</button>
          <button className="icon-btn" title={t('common.refresh')} onClick={loadFiles}>⟳</button>
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
          <div className="file-tree-item muted">{t('files.empty')}</div>
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
                {dirty && <span className="file-dirty" title={t('files.unsaved')}> ●</span>}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? t('files.saving') : t('files.saveShortcut')}
              </button>
            </div>
            <div className="file-editor-body">
              <Editor
                value={fileContent}
                language={editorLanguage}
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
            <span>{t('files.select')}</span>
          </div>
        )}
      </div>

      {nameAction && (
        <Modal
          title={nameAction === 'rename' ? t('files.rename') : nameAction === 'mkdir' ? t('files.newFolder') : t('files.newFile')}
          onClose={() => setNameAction(null)}
        >
          {nameAction !== 'rename' && (
            <p className="modal-hint">
              {t('files.location', { path: targetDir() || '' })}
            </p>
          )}
          <div className="form-field">
            <label>{t('files.name')}</label>
            <input
              type="text"
              value={nameValue}
              autoFocus
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setNameAction(null)}>{t('common.cancel')}</button>
            <button className="btn btn-primary btn-sm" onClick={handleNameSubmit}>{t('common.ok')}</button>
          </div>
        </Modal>
      )}

      {confirmDelete && selected && (
        <ConfirmDialog
          title={t('files.deleteTitle')}
          message={t('files.deleteMessage', {
            path: selected.path,
            inside: selected.type === 'directory' ? t('files.andInside') : '',
          })}
          confirmLabel={t('common.delete')}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
