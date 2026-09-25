import { useState, useEffect, useCallback } from 'react'
import {
  fetchSystemStatus, SystemStatus as SystemStatusData, novncUrl,
  updateClaude, fetchContainerLogs, restartContainer,
} from '../services/api'
import Modal from './Modal'
import { useToast } from './Toast'
import { useLanguage } from '../i18n'

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
  const { t } = useLanguage()

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
    toast('info', t('system.updating'))
    try {
      const version = await updateClaude()
      toast('success', t('system.updated', { version }))
      await load()
    } catch (e) {
      toast('error', t('system.updateFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setUpdating(false)
    }
  }

  async function openLogs(name: string) {
    setLogsFor(name)
    setLogsText(t('system.logsLoading'))
    try {
      setLogsText((await fetchContainerLogs(name)) || t('system.noOutput'))
    } catch (e) {
      setLogsText(t('system.logsFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleRestart(name: string) {
    setRestarting(true)
    try {
      await restartContainer(name)
      toast('success', t('system.restarted', {
        name,
        extra: name === 'ai-gateway' ? t('system.gatewayExtra') : '',
      }))
      await load()
      await openLogs(name)
    } catch (e) {
      toast('error', t('system.restartFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setRestarting(false)
    }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return
    const perm = await Notification.requestPermission()
    setNotifState(perm)
    if (perm === 'granted') toast('success', t('system.notificationsEnabled'))
  }

  if (!status) {
    return (
      <div className="system-status">
        <span className="system-status-item muted">{t('system.unavailable')}</span>
      </div>
    )
  }

  return (
    <div className="system-status">
      <span className="system-status-item">
        {t('system.proxy')}{' '}
        {status.externalIp ? (
          <span className="status-ok">✓ {status.externalIp}</span>
        ) : (
          <span className="status-bad">{t('system.noInternet')}</span>
        )}
      </span>

      <span className="system-status-item">
        {t('system.claudeAuth')}{' '}
        {status.claudeAuth ? (
          <span className="status-ok">{t('system.authorized')}</span>
        ) : (
          <span className="status-bad">
            {t('system.notAuthorized')}{' '}
            <a href={novncUrl()} target="_blank" rel="noopener noreferrer">
              {t('system.loginNovnc')}
            </a>
          </span>
        )}
      </span>

      <span className="system-status-item">
        CLI: {status.claudeVersion || t('system.unknown')}{' '}
        <button className="btn btn-secondary btn-sm" onClick={handleUpdateClaude} disabled={updating}>
          {updating ? t('system.updatingShort') : t('system.update')}
        </button>
      </span>

      {notifState === 'default' && (
        <span className="system-status-item">
          <button className="btn btn-secondary btn-sm" onClick={enableNotifications}>
            {t('system.enableNotifications')}
          </button>
        </span>
      )}

      <span className="system-status-containers">
        {status.containers.map((c) => (
          <button
            key={c.name}
            className={`container-chip ${c.state === 'running' ? 'chip-running' : 'chip-down'}`}
            title={t('system.logsHint', { status: c.status || c.state })}
            onClick={() => openLogs(c.name)}
          >
            {c.name.replace(/^ai-/, '')}
          </button>
        ))}
      </span>

      {logsFor && (
        <Modal title={t('system.logsTitle', { name: logsFor })} onClose={() => setLogsFor(null)} wide>
          <div className="modal-wide-body">
            <pre className="logs-view">{logsText}</pre>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => openLogs(logsFor)}>
                {t('common.refresh')}
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleRestart(logsFor)} disabled={restarting}>
                {restarting ? t('system.restarting') : t('system.restartContainer')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
