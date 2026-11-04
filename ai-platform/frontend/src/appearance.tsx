import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import type { ITheme } from 'xterm'

const STORAGE_KEY = 'appearance'

/** Цвета интерфейса — это CSS-переменные из :root в index.css; здесь их исходные значения. */
export const UI_COLORS = {
  '--bg-0': '#05060f',
  '--bg-1': '#090c18',
  '--bg-2': '#0d1222',
  '--bg-3': '#131a30',
  '--cyan': '#00f0ff',
  '--magenta': '#ff2ec4',
  '--green': '#2bff88',
  '--red': '#ff3b5c',
  '--brass': '#e8b04b',
  '--text': '#d5e5f5',
  '--text-dim': '#7d8fab',
  '--text-faint': '#4a5875',
}

/** Палитра xterm. Выделение хранится цветом, прозрачность ему добавляет `terminalTheme`. */
export const TERMINAL_COLORS = {
  background: '#04070e',
  foreground: '#c9e4f6',
  cursor: '#00f0ff',
  selectionBackground: '#00f0ff',
  black: '#0d1222',
  red: '#ff3b5c',
  green: '#2bff88',
  yellow: '#e8b04b',
  blue: '#4d9fff',
  magenta: '#ff2ec4',
  cyan: '#00f0ff',
  white: '#d5e5f5',
  brightBlack: '#4a5875',
  brightRed: '#ff7591',
  brightGreen: '#7dffb6',
  brightYellow: '#ffd28a',
  brightBlue: '#8ec2ff',
  brightMagenta: '#ff7ad9',
  brightCyan: '#7ff8ff',
  brightWhite: '#f2faff',
}

export type UiColor = keyof typeof UI_COLORS
export type TerminalColor = keyof typeof TERMINAL_COLORS

export interface Appearance {
  ui: Record<UiColor, string>
  terminal: Record<TerminalColor, string>
  /** data:-URL загруженной картинки или обычная ссылка; пусто — без картинки. */
  backgroundImage: string
  /** 0…1 — насколько картинка проступает сквозь фон терминала. */
  imageOpacity: number
}

export const DEFAULT_APPEARANCE: Appearance = {
  ui: UI_COLORS,
  terminal: TERMINAL_COLORS,
  backgroundImage: '',
  imageOpacity: 0.35,
}

function load(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    // Поверх дефолтов: в сохранённом может не оказаться какого-то цвета
    return {
      ...DEFAULT_APPEARANCE,
      ...saved,
      ui: { ...UI_COLORS, ...saved.ui },
      terminal: { ...TERMINAL_COLORS, ...saved.terminal },
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Тема xterm. Картинка лежит под терминалом, в его контейнере, поэтому с ней фон xterm
 * становится полупрозрачным. Инверсный текст xterm красит непрозрачной версией фона,
 * так что он не пропадает.
 */
export function terminalTheme(appearance: Appearance): ITheme {
  const { background, selectionBackground, ...colors } = appearance.terminal
  const alpha = appearance.backgroundImage ? 1 - appearance.imageOpacity : 1
  return {
    ...colors,
    background: hexToRgba(background, alpha),
    cursorAccent: background,
    selectionBackground: hexToRgba(selectionBackground, 0.3),
  }
}

interface AppearanceContextValue {
  appearance: Appearance
  setAppearance: (next: Appearance) => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))
    } catch {
      // Не влезло в localStorage — настройки работают до перезагрузки страницы
    }
    const root = document.documentElement.style
    for (const [name, value] of Object.entries(appearance.ui)) root.setProperty(name, value)
    root.setProperty('--bg-terminal', appearance.terminal.background)
    root.setProperty(
      '--terminal-image',
      appearance.backgroundImage ? `url(${JSON.stringify(appearance.backgroundImage)})` : 'none'
    )
  }, [appearance])

  const value = useMemo(() => ({ appearance, setAppearance }), [appearance])
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext)
  if (!value) throw new Error('useAppearance must be used inside AppearanceProvider')
  return value
}
