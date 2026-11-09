import Capacitor
import CapacitorBrowser

/// Registers this app's local custom plugins (not npm packages) —
/// NativePrintPlugin.swift and NativeCalendarPlugin.swift, both added
/// 2026-10-29 as the iOS counterparts to the Android plugins already built
/// 2026-10-16, NativeAudioSessionPlugin.swift (2026-10-30, Voice Dictation
/// reliability — see its own header comment), and NativeSpeechPlugin.swift
/// (2026-10-31, same Voice Dictation effort — on-device SFSpeechRecognizer
/// in place of the browser's own Web Speech API, see its own header
/// comment for why). Capacitor only auto-discovers plugins that ship as
/// proper npm/SPM packages (via cap sync reading each package's own
/// manifest into capacitor.config.json's packageClassList, see
/// CapacitorBridge.swift's own registerPlugins()); a plugin that's just
/// local Swift files in this app target needs to be registered
/// explicitly, the same reason Android's MainActivity.java registers its
/// own plugins in onCreate() before super.onCreate().
///
/// capacitorDidLoad() is Capacitor's own documented hook for this — called
/// right after the bridge is constructed (CAPBridgeViewController.swift's
/// loadView()), so `bridge` is already available here. Main.storyboard's
/// root view controller is set to this class (customClass="MainViewController",
/// customModule="App") instead of the default CAPBridgeViewController/
/// Capacitor.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativePrintPlugin())
        bridge?.registerPluginInstance(NativeCalendarPlugin())
        bridge?.registerPluginInstance(NativeAudioSessionPlugin())
        bridge?.registerPluginInstance(NativeSpeechPlugin())

        // 2026-11-10, owner debugging the Stripe/Safari hand-off --
        // @capacitor/browser's own CAPBrowserPlugin should auto-register via
        // capacitor.config.json's packageClassList (confirmed correctly
        // listed there) the same way CapacitorApp's own AppPlugin already
        // does -- but it consistently threw "'Browser' plugin is not
        // implemented on ios" / {"code":"UNIMPLEMENTED"} on a real device,
        // confirmed live via Web Inspector, surviving npm install, Reset
        // Package Caches, a Clean Build Folder, and even a full
        // ~/Library/Developer/Xcode/DerivedData wipe -- ruling out every
        // normal staleness/caching explanation. Registering it explicitly
        // here instead, the same proven, reliable path this file's own
        // custom plugins already use, rather than continue chasing why its
        // own auto-discovery isn't working in this project.
        bridge?.registerPluginInstance(CAPBrowserPlugin())

        // 2026-11-10, owner debugging the Stripe/Safari hand-off -- since
        // iOS 16.4, WKWebView content is only reachable from Safari's own
        // Web Inspector (Settings > Safari > Advanced > Web Inspector, then
        // Mac Safari's Develop menu) if the WebView explicitly opts in via
        // isInspectable. Without this, Web Inspector enabled on the device
        // still shows nothing for this app's own content -- only ordinary
        // Safari tabs. Debug-build convenience, not a runtime behavior
        // change; safe to leave in a TestFlight build too, since it still
        // requires the device's own Web Inspector setting to be on.
        if #available(iOS 16.4, *) {
            webView?.isInspectable = true
        }
    }
}
