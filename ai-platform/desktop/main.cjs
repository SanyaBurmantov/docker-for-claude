const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } = require('electron')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')

const PLATFORM_URL = (process.env.AI_PLATFORM_URL || 'http://localhost:9900').replace(/\/$/, '')
const PLATFORM_ORIGIN = new URL(PLATFORM_URL).origin

let mainWindow = null
let overlayWindow = null

function isPlatformUrl(raw) {
  try {
    return new URL(raw).origin === PLATFORM_ORIGIN
  } catch {
    return false
  }
}

function browserPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  }
}

function keepNavigationInsidePlatform(window) {
  window.webContents.on('will-navigate', (event, url) => {
    if (!isPlatformUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    // noVNC deliberately keeps its own window and origin. Other external links
    // should also use the normal browser instead of gaining a privileged window.
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function probeService() {
  return new Promise((resolve) => {
    const url = new URL('/api/health', `${PLATFORM_URL}/`)
    const client = url.protocol === 'https:' ? https : http
    const request = client.get(url, { timeout: 1_500 }, (response) => {
      response.resume()
      // Basic auth returns 401 before /api/health; that still means nginx is up
      // and BrowserWindow can show its normal login prompt.
      resolve(response.statusCode !== undefined && response.statusCode < 500)
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(false))
  })
}

async function loadPlatformWhenReady(window, route = '') {
  while (!window.isDestroyed()) {
    if (await probeService()) {
      await window.loadURL(`${PLATFORM_URL}${route}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#05060f',
    title: 'AI Platform',
    webPreferences: browserPreferences(),
  })
  mainWindow = window
  keepNavigationInsidePlatform(window)
  void window.loadFile(path.join(__dirname, 'loading.html'))
    .then(() => loadPlatformWhenReady(window))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
    overlayWindow?.destroy()
  })
}

function placeOverlay(window) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const [width] = window.getSize()
  window.setPosition(display.workArea.x + display.workArea.width - width - 22, display.workArea.y + 22)
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow

  const window = new BrowserWindow({
    width: 560,
    height: 300,
    minWidth: 400,
    minHeight: 210,
    maxWidth: 900,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#05060f',
    title: 'Voice Helper',
    webPreferences: browserPreferences(),
  })
  overlayWindow = window
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true)
  keepNavigationInsidePlatform(window)
  placeOverlay(window)
  void window.loadFile(path.join(__dirname, 'loading.html'))
    .then(() => loadPlatformWhenReady(window, '/vc/overlay'))
  window.on('closed', () => {
    if (overlayWindow === window) overlayWindow = null
  })
  return window
}

function configureMediaCapture() {
  const currentSession = session.defaultSession
  const allowedPermissions = new Set(['media', 'display-capture'])

  currentSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => (
    isPlatformUrl(requestingOrigin || webContents?.getURL()) && allowedPermissions.has(permission)
  ))
  currentSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isPlatformUrl(webContents.getURL()) && allowedPermissions.has(permission))
  })

  // getDisplayMedia has no browser picker in Electron. VC asks for it only after
  // an explicit click on Help with "System audio" selected, then this grants the
  // screen nearest the cursor together with its loopback audio.
  currentSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isPlatformUrl(request.securityOrigin) || !request.userGesture || !request.audioRequested) {
        callback({})
        return
      }
      const primaryId = String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id)
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      const source = sources.find((candidate) => candidate.display_id === primaryId) || sources[0]
      if (!source) {
        callback({})
        return
      }
      callback({ video: source, audio: 'loopback' })
    } catch {
      callback({})
    }
  })
}

app.whenReady().then(() => {
  configureMediaCapture()

  ipcMain.handle('voice-helper:show-overlay', () => {
    const window = createOverlayWindow()
    placeOverlay(window)
    window.showInactive()
  })
  ipcMain.handle('voice-helper:hide-overlay', () => {
    overlayWindow?.hide()
  })

  createMainWindow()
  app.on('activate', () => {
    if (!mainWindow) createMainWindow()
    else mainWindow.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
