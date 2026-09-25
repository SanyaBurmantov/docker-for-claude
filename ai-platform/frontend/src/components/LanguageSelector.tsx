import { useLanguage, type Language } from '../i18n'

export default function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage()

  return (
    <select
      className="language-select"
      value={language}
      onChange={(event) => setLanguage(event.target.value as Language)}
      aria-label={t('nav.language')}
      title={t('nav.language')}
    >
      <option value="ru">RU</option>
      <option value="en">EN</option>
    </select>
  )
}
