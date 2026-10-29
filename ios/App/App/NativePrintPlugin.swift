import Foundation
import Capacitor
import UIKit

/// iOS counterpart to android/app/src/main/java/com/wouldyouplease/app/
/// NativePrintPlugin.java (2026-10-16) — bridges the web app's existing
/// window.print()-based Print Reports feature (every Print button in the
/// app, all funneled through the one shared printWithExpandedWindow() in
/// app/src/lib/platform.ts) to iOS's native print system. A bare WKWebView
/// has no window.print() of its own, same reasoning as the Android side.
///
/// WKWebView.viewPrintFormatter() is the direct iOS equivalent of Android's
/// WebView.createPrintDocumentAdapter() — it already knows how to render the
/// current page for UIKit's own print system, no custom rendering needed
/// here. The completion handler is the one reliable "genuinely done"
/// signal (printed, saved as PDF, or cancelled) — resolving the JS Promise
/// only once it fires matches NativePrintPlugin.java's own onFinish()
/// reasoning: resolving earlier risks the calling screen's own
/// 'afterprint' listener (platform.ts) tearing down its .print-report DOM
/// content before the OS has actually finished reading it.
@objc(NativePrintPlugin)
public class NativePrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePrintPlugin"
    public let jsName = "NativePrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    @objc func print(_ call: CAPPluginCall) {
        let jobName = call.getString("jobName") ?? "Would You Please"
        // Temporary diagnostic (2026-10-29) — first real-device iOS test
        // showed the print icon highlight briefly then nothing else
        // happened. Logging each step via NSLog, visible in Xcode's own
        // console, confirms where this actually stops. Remove once
        // confirmed reliable.
        NSLog("[NativePrintPlugin] print() called, jobName=\(jobName)")

        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                NSLog("[NativePrintPlugin] no webView")
                call.reject("No WebView available to print.")
                return
            }
            guard let viewController = self.bridge?.viewController else {
                NSLog("[NativePrintPlugin] no viewController")
                call.reject("No view available to print from.")
                return
            }
            guard UIPrintInteractionController.isPrintingAvailable else {
                NSLog("[NativePrintPlugin] isPrintingAvailable is false")
                call.reject("Printing is not available on this device.")
                return
            }
            NSLog("[NativePrintPlugin] about to present, idiom=\(UIDevice.current.userInterfaceIdiom.rawValue)")

            let printInfo = UIPrintInfo(dictionary: nil)
            printInfo.outputType = .general
            printInfo.jobName = jobName

            let printController = UIPrintInteractionController.shared
            printController.printInfo = printInfo
            printController.printFormatter = webView.viewPrintFormatter()

            let completion: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                NSLog("[NativePrintPlugin] completion: completed=\(completed), error=\(String(describing: error))")
                if let error = error {
                    call.reject("Could not print.", nil, error)
                } else {
                    call.resolve()
                }
            }

            // iPad requires a popover anchor (present(animated:) alone
            // asserts/crashes there); iPhone uses the plain full-screen
            // presentation instead.
            if UIDevice.current.userInterfaceIdiom == .pad {
                printController.present(
                    from: viewController.view.bounds,
                    in: viewController.view,
                    animated: true,
                    completionHandler: completion
                )
            } else {
                printController.present(animated: true, completionHandler: completion)
            }
            NSLog("[NativePrintPlugin] present() call returned")
        }
    }
}
