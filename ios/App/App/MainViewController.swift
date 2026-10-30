import Capacitor

/// Registers this app's local custom plugins (not npm packages) —
/// NativePrintPlugin.swift and NativeCalendarPlugin.swift, both added
/// 2026-10-29 as the iOS counterparts to the Android plugins already built
/// 2026-10-16, plus NativeAudioSessionPlugin.swift (2026-10-30, Voice
/// Dictation reliability — see its own header comment). Capacitor only
/// auto-discovers plugins that ship as proper npm/SPM packages (via cap
/// sync reading each package's own manifest into capacitor.config.json's
/// packageClassList, see CapacitorBridge.swift's own registerPlugins()); a
/// plugin that's just local Swift files in this app target needs to be
/// registered explicitly, the same reason Android's MainActivity.java
/// registers its own plugins in onCreate() before super.onCreate().
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
    }
}
