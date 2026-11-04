import { useState, type ChangeEvent } from 'react'
import Modal from './Modal'
import { useLanguage } from '../i18n'
import {
  DEFAULT_APPEARANCE,
  TERMINAL_COLORS,
  UI_COLORS,
  terminalTheme,
  useAppearance,
  type TerminalColor,
  type UiColor,
} from '../appearance'

const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const ANSI_COLORS = ANSI_NAMES as TerminalColor[]
const ANSI_BRIGHT = ANSI_NAMES.map((n) => `bright${n[0].toUpperCase()}${n.slice(1)}`) as TerminalColor[]
const MAIN_TERMINAL_COLORS: TerminalColor[] = ['background', 'foreground', 'cursor', 'selectionBackground']

/** Картинка хранится в localStorage (~5 МБ на сайт), поэтому её ужимаем до разумного размера. */
const MAX_IMAGE_SIDE = 1920

async function imageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** Кнопка в навбаре и окно «Оформление»: правки применяются сразу, без «Сохранить». */
export default function AppearanceSettings() {
  const [open, setOpen] = useState(false)
  const { t } = useLanguage()

  return (
    <>
      <button className="nav-link" onClick={() => setOpen(true)} title={t('appearance.title')}>
        🎨
      </button>
      {open && (
        <Modal title={t('appearance.title')} onClose={() => setOpen(false)} wide>
          <AppearanceForm />
        </Modal>
      )}
    </>
  )
}

function AppearanceForm() {
  const { appearance, setAppearance } = useAppearance()
  const { t } = useLanguage()
  const [imageError, setImageError] = useState('')
  const hasUploadedImage = appearance.backgroundImage.startsWith('data:')

  function setTerminalColor(key: TerminalColor, value: string) {
    setAppearance({ ...appearance, terminal: { ...appearance.terminal, [key]: value } })
  }

  function setUiColor(key: UiColor, value: string) {
    setAppearance({ ...appearance, ui: { ...appearance.ui, [key]: value } })
  }

  async function uploadImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setAppearance({ ...appearance, backgroundImage: await imageToDataUrl(file) })
      setImageError('')
    } catch {
      setImageError(t('appearance.imageError'))
    }
  }

  function colorInput(value: string, onChange: (value: string) => void, title: string) {
    return (
      <input
        type="color"
        className="appearance-color"
        value={value}
        title={title}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  const theme = terminalTheme(appearance)

  return (
    <div className="appearance-form">
      <div className="appearance-preview" style={{ color: theme.foreground }}>
        <div className="appearance-preview-tint" style={{ background: theme.background }} />
        <div className="appearance-preview-text">
          <div>
            <span style={{ color: theme.green }}>claude@ai</span>:<span style={{ color: theme.blue }}>~/project</span>$ npm run build
            <span className="appearance-preview-cursor" style={{ background: theme.cursor }} />
          </div>
          <div>
            {[...ANSI_COLORS, ...ANSI_BRIGHT].map((key) => (
              <span key={key} style={{ color: appearance.terminal[key] }}>■</span>
            ))}
          </div>
          <div>
            <span style={{ background: theme.selectionBackground }}>{t('appearance.previewSelection')}</span>
          </div>
        </div>
      </div>

      <section className="appearance-section">
        <h4>{t('appearance.terminalBackground')}</h4>
        <div className="appearance-row">
          <label className="btn btn-secondary btn-sm">
            {t('appearance.chooseImage')}
            <input type="file" accept="image/*" hidden onChange={uploadImage} />
          </label>
          <input
            type="text"
            className="appearance-url"
            placeholder={t('appearance.imageUrl')}
            value={hasUploadedImage ? '' : appearance.backgroundImage}
            onChange={(e) => setAppearance({ ...appearance, backgroundImage: e.target.value.trim() })}
          />
          <button
            className="btn btn-secondary btn-sm"
            disabled={!appearance.backgroundImage}
            onClick={() => setAppearance({ ...appearance, backgroundImage: '' })}
          >
            {t('appearance.removeImage')}
          </button>
        </div>
        {hasUploadedImage && <p className="appearance-hint">{t('appearance.imageUploaded')}</p>}
        {imageError && <p className="appearance-hint appearance-error">{imageError}</p>}
        <label className="appearance-row appearance-slider">
          <span>{t('appearance.imageOpacity')}</span>
          <input
            type="range"
            min={0}
            max={100}
            disabled={!appearance.backgroundImage}
            value={Math.round(appearance.imageOpacity * 100)}
            onChange={(e) => setAppearance({ ...appearance, imageOpacity: Number(e.target.value) / 100 })}
          />
          <span className="appearance-value">{Math.round(appearance.imageOpacity * 100)}%</span>
        </label>
      </section>

      <section className="appearance-section">
        <h4>{t('appearance.terminalColors')}</h4>
        <div className="appearance-grid">
          {MAIN_TERMINAL_COLORS.map((key) => (
            <label key={key} className="appearance-color-field">
              {colorInput(appearance.terminal[key], (v) => setTerminalColor(key, v), key)}
              <span>{t(`appearance.terminal.${key}`)}</span>
            </label>
          ))}
        </div>
        <p className="appearance-hint">{t('appearance.ansiHint')}</p>
        {[ANSI_COLORS, ANSI_BRIGHT].map((row, i) => (
          <div key={i} className="appearance-ansi">
            {row.map((key) => (
              <span key={key}>{colorInput(appearance.terminal[key], (v) => setTerminalColor(key, v), key)}</span>
            ))}
          </div>
        ))}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setAppearance({ ...appearance, terminal: TERMINAL_COLORS })}
        >
          {t('appearance.resetTerminal')}
        </button>
      </section>

      <section className="appearance-section">
        <h4>{t('appearance.uiColors')}</h4>
        <div className="appearance-grid">
          {(Object.keys(UI_COLORS) as UiColor[]).map((key) => (
            <label key={key} className="appearance-color-field">
              {colorInput(appearance.ui[key], (v) => setUiColor(key, v), key)}
              <span>{t(`appearance.ui.${key}`)}</span>
            </label>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setAppearance({ ...appearance, ui: UI_COLORS })}>
          {t('appearance.resetUi')}
        </button>
      </section>

      <div className="modal-actions">
        <button className="btn btn-danger btn-sm" onClick={() => setAppearance(DEFAULT_APPEARANCE)}>
          {t('appearance.resetAll')}
        </button>
      </div>
    </div>
  )
}
