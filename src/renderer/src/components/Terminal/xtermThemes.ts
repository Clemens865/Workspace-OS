import type { ITheme } from 'xterm'
import type { Theme } from '../../hooks/useTheme'

/**
 * The shell's colours, by app theme. Light: ink on the landscape's paper.
 * Dark: moonlight ink on the night paper. The ANSI palettes are muted so
 * output reads as part of the app rather than a harsh console.
 */
const LIGHT: ITheme = {
  background: '#fbfcfd',
  foreground: '#1b2730',
  cursor: '#1b2730',
  cursorAccent: '#fbfcfd',
  selectionBackground: 'rgba(27, 39, 48, 0.14)',
  black: '#3a3a3e',
  red: '#c0392b',
  green: '#1e8e4e',
  yellow: '#9a6a00',
  blue: '#2f5f9e',
  magenta: '#8e44ad',
  cyan: '#00838f',
  white: '#6e6e73',
  brightBlack: '#8a8a8e',
  brightRed: '#e03131',
  brightGreen: '#2fa860',
  brightYellow: '#b5820b',
  brightBlue: '#3a7bd5',
  brightMagenta: '#a55ec7',
  brightCyan: '#0fa0b0',
  brightWhite: '#1d1d1f',
}

const DARK: ITheme = {
  background: '#182129',
  foreground: '#e6ecf0',
  cursor: '#e6ecf0',
  cursorAccent: '#182129',
  selectionBackground: 'rgba(230, 236, 240, 0.18)',
  black: '#2a333b',
  red: '#f08b7a',
  green: '#6fcf97',
  yellow: '#eab55a',
  blue: '#7aa7e6',
  magenta: '#c49be6',
  cyan: '#46b9a9',
  white: '#b9c5cd',
  brightBlack: '#5f6d78',
  brightRed: '#ffa696',
  brightGreen: '#8fe0b0',
  brightYellow: '#f5cd85',
  brightBlue: '#9cc0f2',
  brightMagenta: '#d8b8f2',
  brightCyan: '#6fd3c4',
  brightWhite: '#ffffff',
}

export const xtermTheme = (t: Theme): ITheme => (t === 'dark' ? DARK : LIGHT)
