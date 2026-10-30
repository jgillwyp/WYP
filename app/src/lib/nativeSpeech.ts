import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

/**
 * Local custom Capacitor plugin (ios/App/App/NativeSpeechPlugin.swift)
 * running on-device speech recognition directly via Apple's own
 * SFSpeechRecognizer, with requiresOnDeviceRecognition forced on — see
 * that file's own header comment for why this exists: the browser's own
 * Web Speech API (useSpeechDictation.ts's original implementation) works
 * exactly once per app launch, then fails for a while, matching Apple's
 * documented Speech-framework quota behavior; developer reports say that
 * quota shows up mostly on server-side recognition, which WebKit's own
 * internal implementation gives JS no way to opt out of.
 *
 * Streams "result" events (one per partial or final piece of speech),
 * an "error" event, and an "end" event once a session genuinely
 * finishes. See the NativeSpeechRecognitionAdapter class in
 * useSpeechDictation.ts for how these get translated into the exact
 * same onresult/onerror/onend shape the Web Speech API already uses, so
 * every other line of that hook's own merge/silence-timer/status-note
 * logic needed zero changes.
 */
export interface NativeSpeechPlugin {
  start(): Promise<void>
  stop(): Promise<void>
  addListener(
    eventName: 'result',
    listenerFunc: (data: { transcript: string; isFinal: boolean }) => void
  ): Promise<PluginListenerHandle>
  addListener(eventName: 'error', listenerFunc: (data: { code: string }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'end', listenerFunc: () => void): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

const NativeSpeech = registerPlugin<NativeSpeechPlugin>('NativeSpeech')

export default NativeSpeech
