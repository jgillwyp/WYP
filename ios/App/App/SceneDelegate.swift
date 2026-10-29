import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // 2026-10-29, first real-device test of the native Print/Calendar
        // plugins: this app launches via the UIScene lifecycle, which
        // builds its root view controller directly here in code — the
        // Main.storyboard's own customClass (set to MainViewController)
        // is never consulted at all, since nothing here ever loads that
        // storyboard. MainViewController's capacitorDidLoad() override,
        // where NativePrintPlugin/NativeCalendarPlugin actually get
        // registered, was therefore never running — every call to either
        // plugin failed with Capacitor's own "UNIMPLEMENTED" error, since
        // the bridge had genuinely never heard of them.
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
