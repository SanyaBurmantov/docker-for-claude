const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  showOverlay: () => ipcRenderer.invoke('voice-helper:show-overlay'),
  hideOverlay: () => ipcRenderer.invoke('voice-helper:hide-overlay'),
  captureScreen: () => ipcRenderer.invoke('voice-helper:capture-screen'),
}))
