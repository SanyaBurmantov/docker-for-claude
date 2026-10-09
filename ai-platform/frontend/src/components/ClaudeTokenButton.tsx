import { useEffect, useState } from 'react'
import Modal from './Modal'
import Terminal from './Terminal'
import {
  addClaudeToken, closeClaudeLogin, deleteClaudeToken, errorMessage, fetchClaudeTokens,
  renameClaudeToken, saveCurrentClaudeLogin, selectClaudeToken, startClaudeLogin, type ClaudeToken,
} from '../services/api'
import { useLanguage } from '../i18n'

interface Props {
  projectId?: string
  disabled?: boolean
  onSwitch?: () => void
}

/** Select value of "follow the global account"; only a project can choose it. */
const INHERIT = ''

export default function ClaudeTokenButton({ projectId, disabled, onSwitch }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [tokens, setTokens] = useState<ClaudeToken[]>([])
  const [selected, setSelected] = useState('default')
  const [inherited, setInherited] = useState(false)
  const [choice, setChoice] = useState('default')
  const [form, setForm] = useState<'none' | 'add' | 'rename' | 'delete'>('none')
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  /** The throwaway window a new account signs in through. */
  const [login, setLogin] = useState<{ id: string; session: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // What the server currently has for this scope, in the select's own vocabulary.
  const current = inherited ? INHERIT : selected
  const chosen = tokens.find(item => item.id === choice)
  const effective = tokens.find(item => item.id === selected)
  const pending = login && tokens.find(item => item.id === login.id)
  const signedIn = Boolean(pending?.hasLogin)

  function describe(item?: ClaudeToken): string {
    if (!item) return t('tokens.unknownAccount')
    const label = item.id === 'default' ? t('tokens.currentLogin') : item.name
    const account = item.account && item.account !== label ? ` — ${item.account}` : ''
    return `${label}${account}${item.hasLogin ? '' : ` — ${t('tokens.noLogin')}`}`
  }

  useEffect(() => {
    if (!open) return
    let active = true
    setLoaded(false)
    setError('')
    fetchClaudeTokens(projectId).then(data => {
      if (!active) return
      setTokens(data.tokens); setSelected(data.selected); setInherited(data.inherited)
      setChoice(data.inherited ? INHERIT : data.selected); setLoaded(true)
    }).catch(() => { if (active) setError(t('tokens.loadError')) })
    return () => { active = false }
  }, [open, projectId, t])

  // The list changes behind the page: a login finishing in the window below, or
  // one made in a terminal and picked up by the background save.
  useEffect(() => {
    if (!open || !loaded || busy) return
    let active = true
    let refreshing = false
    const timer = window.setInterval(async () => {
      if (refreshing) return
      refreshing = true
      try {
        const data = await fetchClaudeTokens(projectId)
        if (!active) return
        setTokens(data.tokens)
        setSelected(data.selected)
        setInherited(data.inherited)
        // Follow the server only while the user has not picked something else.
        setChoice(value => value === current ? (data.inherited ? INHERIT : data.selected) : value)
      } catch {
        // Keep the current list during a container restart; initial errors are shown above.
      } finally { refreshing = false }
    }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [open, loaded, busy, projectId, current])

  /** The project page keeps its Claude terminal mounted, so it has to be told
   *  which sessions were restarted under it. */
  function announce(restarted: string[]) {
    for (const project of restarted) {
      window.dispatchEvent(new CustomEvent('claude-token-changed', { detail: { projectId: project, restarted: true } }))
    }
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (err) { setError(errorMessage(err, fallback)) }
    // Every action here can restart or end a session, so the page re-reads what runs.
    finally { setBusy(false); onSwitch?.() }
  }

  function switched(restarted: string[]) {
    setNotice(restarted.length ? t('tokens.restarted', { projects: restarted.join(', ') }) : t('tokens.selected'))
    announce(restarted)
  }

  function close() {
    if (busy) return
    // An abandoned login window would keep a terminal and an empty account alive.
    if (login) { void closeClaudeLogin(login.id).catch(() => {}); setLogin(null) }
    setOpen(false); setForm('none'); setName(''); setToken(''); setError(''); setNotice('')
  }

  const apply = () => run(async () => {
    const result = await selectClaudeToken(choice === INHERIT ? null : choice, projectId)
    setSelected(result.selected); setInherited(result.inherited)
    setChoice(result.inherited ? INHERIT : result.selected)
    switched(result.restarted)
  }, t('tokens.switchError'))

  const add = () => run(async () => {
    const data = await addClaudeToken(name.trim(), token.trim())
    setTokens(data.tokens); setToken(''); setName(''); setForm('none')
    setNotice(t('tokens.added'))
  }, t('tokens.addError'))

  const rename = () => run(async () => {
    const data = await renameClaudeToken(choice, name.trim())
    setTokens(data.tokens); setName(''); setForm('none')
    setNotice(t('tokens.renamed'))
  }, t('tokens.renameError'))

  const remove = () => run(async () => {
    const data = await deleteClaudeToken(choice)
    setTokens(data.tokens); setForm('none')
    // Whatever used the deleted account now follows the one above it.
    const next = await fetchClaudeTokens(projectId)
    setSelected(next.selected); setInherited(next.inherited)
    setChoice(next.inherited ? INHERIT : next.selected)
    setNotice(t('tokens.deleted'))
    announce(data.restarted)
  }, t('tokens.deleteError'))

  const capture = () => run(async () => {
    const data = await saveCurrentClaudeLogin(projectId)
    setTokens(data.tokens)
    setNotice(t('tokens.savedLogin'))
  }, t('tokens.saveLoginError'))

  const openLogin = () => run(async () => {
    const data = await startClaudeLogin(t('tokens.newAccount'))
    setTokens(data.tokens); setForm('none')
    setLogin({ id: data.id, session: data.session })
  }, t('tokens.loginError'))

  /** Closes the window and switches to the account that signed in; one closed
   *  before the login finished leaves nothing behind. */
  const finishLogin = (use: boolean) => run(async () => {
    if (!login) return
    const data = await closeClaudeLogin(login.id)
    const saved = data.tokens.some(item => item.id === login.id)
    setTokens(data.tokens); setLogin(null)
    if (!use || !saved) return
    const result = await selectClaudeToken(login.id, projectId)
    setSelected(result.selected); setInherited(result.inherited); setChoice(result.selected)
    switched(result.restarted)
  }, t('tokens.loginError'))

  return <>
    <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => setOpen(true)}>
      {t('tokens.button')}
    </button>
    {open && <Modal title={t('tokens.title')} onClose={close} wide={Boolean(login)}>
      <div className="claude-token-form">
        {login ? <>
          <p className="claude-token-hint">{t('tokens.loginHint')}</p>
          <div className="claude-login">
            <Terminal sessionId={login.session} label={t('tokens.loginLabel')} />
          </div>
          <div role="status">{signedIn ? t('tokens.loginReady', { account: describe(pending || undefined) }) : t('tokens.loginWaiting')}</div>
          {error && <div role="alert" className="claude-token-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => finishLogin(false)}>
              {signedIn ? t('tokens.loginKeep') : t('common.cancel')}
            </button>
            <button className="btn btn-success btn-sm" disabled={busy || !signedIn} onClick={() => finishLogin(true)}>
              {t('tokens.loginUse')}
            </button>
          </div>
        </> : <>
          <label className="form-field">
            <span>{t('tokens.choose')}</span>
            <select value={choice} onChange={e => setChoice(e.target.value)} disabled={!loaded || busy}>
              {projectId && <option value={INHERIT}>{t('tokens.inherit')}</option>}
              {tokens.map(item => <option key={item.id} value={item.id}>{describe(item)}</option>)}
            </select>
          </label>
          <p className="claude-token-hint">{t('tokens.effective', { account: describe(effective) })}</p>
          <p className="claude-token-hint">{t(projectId ? 'tokens.projectHint' : 'tokens.globalHint')}</p>
          {error && <div role="alert" className="claude-token-error">{error}</div>}
          {notice && <div role="status">{notice}</div>}
          {form === 'add' || form === 'rename' ? <>
            <label className="form-field">
              <span>{t('tokens.name')}</span>
              <input autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} disabled={busy} />
            </label>
            {form === 'add' && <>
              <label className="form-field">
                <span>{t('tokens.value')}</span>
                <textarea className="claude-token-secret" value={token} onChange={e => setToken(e.target.value)}
                  rows={4} maxLength={32000} autoComplete="off" spellCheck={false} disabled={busy} />
              </label>
              <p className="claude-token-hint">{t('tokens.inputHint')}</p>
            </>}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setForm('none'); setToken(''); setName('') }}>{t('common.cancel')}</button>
              <button className="btn btn-success btn-sm" disabled={busy || !name.trim() || (form === 'add' && !token.trim())}
                onClick={form === 'add' ? add : rename}>{t('common.save')}</button>
            </div>
          </> : form === 'delete' ? <>
            <p className="claude-token-hint">{t('tokens.deleteConfirm', { account: describe(chosen) })}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setForm('none')}>{t('common.cancel')}</button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>{t('tokens.delete')}</button>
            </div>
          </> : <>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" disabled={busy || !loaded} onClick={openLogin}>{t('tokens.login')}</button>
              <button className="btn btn-secondary btn-sm" disabled={busy || !loaded} onClick={capture}>{t('tokens.saveLogin')}</button>
              <button className="btn btn-secondary btn-sm" disabled={busy || !loaded} onClick={() => { setForm('add'); setName(''); setToken('') }}>{t('tokens.add')}</button>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" disabled={busy || !chosen || choice === 'default'}
                onClick={() => { setForm('rename'); setName(chosen?.name ?? '') }}>{t('tokens.rename')}</button>
              <button className="btn btn-danger btn-sm" disabled={busy || !chosen || choice === 'default'}
                onClick={() => setForm('delete')}>{t('tokens.delete')}</button>
              <button className="btn btn-success btn-sm" disabled={busy || !loaded || choice === current} onClick={apply}>
                {busy ? t('tokens.switching') : t('tokens.use')}
              </button>
            </div>
          </>}
        </>}
      </div>
    </Modal>}
  </>
}
