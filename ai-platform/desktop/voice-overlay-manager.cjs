const { app, BrowserWindow, screen } = require('electron')
const path = require('path')

let overlayWindow = null

function createOverlay() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  overlayWindow = new BrowserWindow({
    width: 320,
    height: 180,
    x: width - 340,
    y: height - 200,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
  })

  // Load the voice overlay URL
  overlayWindow.loadURL('http://localhost:5173/vc/overlay') // Assuming frontend runs on 5173
  
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

// IPC handlers for show/hide
// ...
