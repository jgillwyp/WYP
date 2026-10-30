import Foundation
import Capacitor
import AVFoundation

/// Voice Dictation (2026-10-30, owner-reported) — AppDelegate.swift's own
/// one-time AVAudioSession activation at app launch fixed the very first
/// dictation attempt after a fresh launch (confirmed via live console
/// diagnostics: onresult fired, real text was captured), but every attempt
/// after that went straight back to "aborted, zero audio captured," the
/// exact symptom the launch-time fix was meant to close. The leading
/// explanation: WebKit's own internal speech-recognition audio engine tears
/// the session back down once a recognition session ends, and nothing was
/// reactivating it before the next one started.
///
/// There's no WKUIDelegate hook for "a page just called
/// recognition.start()" the way there is for getUserMedia's own media
/// capture permission — Web Speech API recognition runs through WebKit's
/// internal Speech framework integration, not exposed to native code. So
/// rather than guessing *when* WebKit tears the session down, this plugin
/// lets useSpeechDictation.ts re-assert the session right before every
/// single start() call, removing the dependency on that timing entirely.
@objc(NativeAudioSessionPlugin)
public class NativeAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAudioSessionPlugin"
    public let jsName = "NativeAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ensureActive", returnType: CAPPluginReturnPromise)
    ]

    @objc func ensureActive(_ call: CAPPluginCall) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            call.resolve()
        } catch {
            call.reject("Could not activate the audio session.", nil, error)
        }
    }
}
