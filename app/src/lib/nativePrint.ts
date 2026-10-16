import { registerPlugin } from '@capacitor/core'

/**
 * Local custom Capacitor plugin (android/app/src/main/java/com/wouldyouplease/app/
 * NativePrintPlugin.java) bridging the web app's existing window.print()-based
 * Print Reports feature to Android's native print system -- a bare Capacitor
 * WebView does not implement window.print() itself, unlike a full browser or
 * the browser-installed PWA. See printWithExpandedWindow() in ./platform.ts,
 * the one shared function every Print button in the app already calls
 * through, for how this gets wired in without touching any of the individual
 * screens that trigger a print.
 */
export interface NativePrintPlugin {
  print(options: { jobName: string }): Promise<void>
}

const NativePrint = registerPlugin<NativePrintPlugin>('NativePrint')

export default NativePrint
