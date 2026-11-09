import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Voice Dictation (2026-10-30, owner-reported): the mic icon turned
        // red for this app's own 4-second silence timeout on every attempt,
        // then errored "aborted" with zero text captured -- console
        // diagnostics confirmed onresult never fired at all, so the mic
        // audio itself was never reaching the recognizer, not a permissions
        // problem (the prompt had already been granted). WebKit's own
        // speech recognition needs a compatible AVAudioSession to actually
        // record from; Safari configures one for its own web content
        // automatically, but a third-party app hosting WKWebView content
        // (this app) has to do it itself, or the recognizer starts with no
        // real audio behind it and aborts almost immediately -- matching
        // what was observed. Configured once at launch, before any
        // WebView content can ever ask to record.
        //
        // Dispatched off the main thread (2026-11-10, owner-reported: the
        // app froze on first launch on a real device) -- Xcode's own "Hang
        // Risk" diagnostic flagged session.setActive(true) here as exactly
        // this: a synchronous call on the main thread during
        // didFinishLaunchingWithOptions can block the UI from ever
        // appearing if audio-session activation takes any real time (e.g.
        // negotiating Bluetooth HFP routing with a connected headset).
        // didFinishLaunchingWithOptions doesn't need this to finish before
        // returning true, and the only thing it was ever warming up for --
        // the *first* Voice Dictation attempt -- has plenty of time to
        // complete in the background before a user could navigate to a
        // screen and tap the mic button. Every later attempt already
        // re-activates the session itself via NativeAudioSessionPlugin's
        // own ensureActive(), unaffected by this change.
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetoothHFP])
                try session.setActive(true)
            } catch {
                NSLog("[AppDelegate] AVAudioSession setup failed: \(error)")
            }
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
