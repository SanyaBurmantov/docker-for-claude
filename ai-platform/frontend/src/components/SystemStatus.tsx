import { useState, useEffect, useCallback } from 'react'
import {
  fetchSystemStatus, SystemStatus as SystemStatusData, novncUrl,
  updateClaude, fetchContainerLogs, restartContainer,
} from '../services/api'
import Modal from './Modal'
import { useToast } from './Toast'

export default function SystemStatus() {
  const [status, setStatus] = useState<SystemStatusData | null>(null)
  const [updating, setUpdating] = useState(false)
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [logsText, setLogsText] = useState('')
  const [restarting, setRestarting] = useState(false)
  const [notifState, setNotifState] = useState<NotificationPermission | 'unsupported'>(
    'Notification' in window ? Notification.permission : 'unsupported'
  )
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setStatus(await fetchSystemStatus())
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [load])

  async function handleUpdateClaude() {
    setUpdating(true)
    toast('info', 'Updating Claude CLI — this can take a minute…')
    try {
      const version = await updateClaude()
      toast('success', `Claude CLI updated: ${version}`)
      await load()
    } catch (e) {
      toast('error', `Update failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setUpdating(false)
    }
  }

  async function openLogs(name: string) {
    setLogsFor(name)
    setLogsText('Loading…')
    try {
      setLogsText((await fetchContainerLogs(name)) || '(no output)')
    } catch (e) {
      setLogsText(`Failed to load logs: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleRestart(name: string) {
    setRestarting(true)
    try {
      await restartContainer(name)
      toast('success', `${name} restarted${name === 'ai-gateway' ? ' (with claude & browser)' : ''}`)
      await load()
      await openLogs(name)
    } catch (e) {
      toast('error', `Restart failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setRestarting(false)
    }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return
    const perm = await Notification.requestPermission()
    setNotifState(perm)
    if (perm === 'granted') toast('success', 'Browser notifications enabled')
  }

  if (!status) {
    return (
      <div className="system-status">
        <span className="system-status-item muted">System status unavailable</span>
      </div>
    )
  }

  return (
    <div className="system-status">
      <span className="system-status-item">
        Proxy:{' '}
        {status.externalIp ? (
          <span className="status-ok">✓ {status.externalIp}</span>
        ) : (
          <span className="status-bad">✗ no internet (kill switch?)</span>
        )}
      </span>

      <span className="system-status-item">
        Claude auth:{' '}
        {status.claudeAuth ? (
          <span className="status-ok">✓ authorized</span>
        ) : (
          <span className="status-bad">
            ✗ not authorized —{' '}
            <a href={novncUrl()} target="_blank" rel="noopener noreferrer">
              login via noVNC
            </a>
          </span>
        )}
      </span>

      <span className="system-status-item">
        CLI: {status.claudeVersion || 'unknown'}{' '}
        <button className="btn btn-secondary btn-sm" onClick={handleUpdateClaude} disabled={updating}>
          {updating ? 'Updating…' : 'Update'}
        </button>
      </span>

      {notifState === 'default' && (
        <span className="system-status-item">
          <button className="btn btn-secondary btn-sm" onClick={enableNotifications}>
            🔔 Enable notifications
          </button>
        </span>
      )}

      <span className="system-status-containers">
        {status.containers.map((c) => (
          <button
            key={c.name}
            className={`container-chip ${c.state === 'running' ? 'chip-running' : 'chip-down'}`}
            title={`${c.status || c.state} — click for logs`}
            onClick={() => openLogs(c.name)}
          >
            {c.name.replace(/^ai-/, '')}
          </button>
        ))}
      </span>

      {logsFor && (
        <Modal title={`Logs: ${logsFor}`} onClose={() => setLogsFor(null)} wide>
          <div className="modal-wide-body">
            <pre className="logs-view">{logsText}</pre>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => openLogs(logsFor)}>
                Refresh
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleRestart(logsFor)} disabled={restarting}>
                {restarting ? 'Restarting…' : 'Restart container'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
