export {}

declare global {
  interface Window {
    aiDesktop?: {
      isDesktop: true
      platform: string
      showOverlay(): Promise<void>
      hideOverlay(): Promise<void>
      captureScreen(): Promise<ArrayBuffer | null>
    }
  }
}
