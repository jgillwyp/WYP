import { registerPlugin } from '@capacitor/core'

/**
 * Local custom Capacitor plugin (ios/App/App/NativeAudioSessionPlugin.swift)
 * ensuring the native AVAudioSession is active and configured for recording
 * right before each Voice Dictation attempt starts.
 *
 * iOS-observed, 2026-10-30: AppDelegate.swift's own one-time activation at
 * app launch (see its header comment) fixed the very first dictation
 * attempt after a fresh launch, but every attempt after that went straight
 * back to "aborted, zero audio captured." The leading explanation is that
 * WebKit's own internal speech-recognition audio engine tears the session
 * back down once each recognition session ends, with nothing reactivating
 * it before the next one starts. Re-asserting .playAndRecord + setActive
 * right before every single start() — not just once at launch — removes
 * the dependency on guessing exactly when that teardown happens. See
 * useSpeechDictation.ts's own call site for how this is used; a rejection
 * here is treated as best-effort (dictation still attempts to start
 * regardless), not a hard failure.
 */
export interface NativeAudioSessionPlugin {
  ensureActive(): Promise<void>
}

const NativeAudioSession = registerPlugin<NativeAudioSessionPlugin>('NativeAudioSession')

export default NativeAudioSession
