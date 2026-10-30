import Foundation
import Capacitor
import Speech
import AVFoundation

/// Voice Dictation (2026-10-31, owner-reported) — the browser's own Web
/// Speech API (webkitSpeechRecognition, used via useSpeechDictation.ts)
/// works exactly once per app launch, then fails for a few minutes, then
/// recovers on its own. That pattern matches Apple's own documented
/// Speech-framework quota/throttling behavior, and developer forum
/// reports say that quota shows up "far more often with server-side
/// recognition than on-device" — a signal worth trying before paying for
/// a cloud transcription API, since WebKit's own JS-level API gives no
/// way to request on-device-only mode at all. This plugin uses
/// SFSpeechRecognizer directly (the same mature, iOS-10+ API WebKit's
/// own implementation almost certainly wraps internally) with
/// requiresOnDeviceRecognition forced on, so it's testable without
/// betting on the brand-new iOS 26 SpeechAnalyzer framework.
///
/// Streams partial and final results back to JS via notifyListeners
/// (events: "result" {transcript, isFinal}, "error" {code}, "end" {}) —
/// nativeSpeech.ts's own NativeSpeechRecognitionAdapter wraps these events
/// into the exact same shape the Web Speech API's onresult/onerror/onend
/// already provide, so every other line of useSpeechDictation.ts's own
/// merge/silence-timer/status-note logic needed zero changes.
///
/// Unlike the Web Speech API's own short (~1s) internal pause-then-
/// restart cycle, a SFSpeechAudioBufferRecognitionRequest fed via a
/// continuous AVAudioEngine tap does NOT auto-finalize on a brief pause —
/// it keeps listening until endAudio() (stop(), below) is called, an
/// error occurs, or the historical ~60s per-request structural cap is
/// hit. That means useSpeechDictation.ts's own 4-second JS silence timer
/// is now the only thing that ever calls stop() under normal use; the
/// shared hook's onend-triggered restart path exists for the Web Speech
/// case and should simply never fire here.
@objc(NativeSpeechPlugin)
public class NativeSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSpeechPlugin"
    public let jsName = "NativeSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    // Safety cap mirroring the historical ~60s per-request limit on
    // plain SFSpeechRecognizer -- a normal dictation attempt (already
    // auto-stopped by the JS silence timer well before this) should never
    // actually hit it, but a stuck session shouldn't be able to run
    // (and keep the mic open) forever either.
    private var maxDurationTimer: Timer?

    @objc func start(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard authStatus == .authorized else {
                    call.reject("Speech recognition was not authorized.")
                    return
                }
                self.beginSession(call)
            }
        }
    }

    private func beginSession(_ call: CAPPluginCall) {
        teardown()

        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
            call.reject("The on-device speech recognizer is unavailable right now.")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // The whole point of this plugin -- see its own header comment.
        request.requiresOnDeviceRecognition = true
        recognitionRequest = request

        let engine = AVAudioEngine()
        audioEngine = engine
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            teardown()
            call.reject("Could not start the audio engine.", nil, error)
            return
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                self.notifyListeners("result", data: [
                    "transcript": result.bestTranscription.formattedString,
                    "isFinal": result.isFinal
                ])
                if result.isFinal {
                    self.teardown()
                    self.notifyListeners("end", data: [:])
                }
            }
            if let error = error {
                let description = error.localizedDescription
                // Version-resilient on purpose -- SFSpeechRecognizer's own
                // "nothing was said" error code has shifted across iOS
                // releases; matching the message text survives that.
                let code = description.lowercased().contains("no speech") ? "no-speech" : "aborted"
                self.teardown()
                self.notifyListeners("error", data: ["code": code])
            }
        }

        maxDurationTimer?.invalidate()
        maxDurationTimer = Timer.scheduledTimer(withTimeInterval: 55, repeats: false) { [weak self] _ in
            self?.recognitionRequest?.endAudio()
        }

        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        recognitionRequest?.endAudio()
        call.resolve()
    }

    private func teardown() {
        maxDurationTimer?.invalidate()
        maxDurationTimer = nil
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
    }
}
