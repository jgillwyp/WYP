import Foundation
import Capacitor
import UIKit
import EventKit
import EventKitUI

/// iOS counterpart to android/app/src/main/java/com/wouldyouplease/app/
/// NativeCalendarPlugin.java (2026-10-16) — bridges the web app's existing
/// "Add to Calendar" button (RequestResponseForm.tsx, ResponseDetailForm.tsx,
/// TodoDetailForm.tsx, CreateTodoForm.tsx) to a real native calendar event,
/// replacing the .ics-Blob-download path used on the web/PWA there.
///
/// Uses EKEventEditViewController — Apple's own stock "let the person review
/// and save an event" sheet, the direct iOS equivalent of Android's
/// Intent.ACTION_INSERT hand-off. Deliberately not EKEventStore.save()
/// directly: this plugin never touches the person's calendar data itself,
/// it only builds an unsaved EKEvent and hands it to Apple's own editor UI,
/// which performs the actual save once the person taps Add there — same
/// "the Calendar app itself does the write" posture Android's own
/// Intent-hand-off comment already describes. Confirmed (web search,
/// 2026-10-29) that EKEventEditViewController presented this way runs
/// out-of-process and needs no NSCalendarsUsageDescription/
/// NSCalendarsFullAccessUsageDescription at all — this app never directly
/// reads or writes the event store, so none was added to Info.plist.
///
/// Same deliberate trade-off as the Android side: there's no way to pre-set
/// a reminder/alarm offset through this stock editor the way the .ics path's
/// own AddToCalendarAlarmsDialog.tsx lets a person choose — the web side
/// already skips that dialog on any native platform and calls this plugin
/// directly.
@objc(NativeCalendarPlugin)
public class NativeCalendarPlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
    public let identifier = "NativeCalendarPlugin"
    public let jsName = "NativeCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "addEvent", returnType: CAPPluginReturnPromise)
    ]

    // Held only while the editor sheet is on screen. The web side only ever
    // has one Add-to-Calendar sheet open at a time, so there's never more
    // than one pending call here.
    private var pendingCall: CAPPluginCall?

    @objc func addEvent(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let description = call.getString("description") ?? ""
        let allDay = call.getBool("allDay") ?? false

        guard let startMillis = call.getDouble("startMillis"),
              let endMillis = call.getDouble("endMillis") else {
            call.reject("startMillis and endMillis are required.")
            return
        }

        DispatchQueue.main.async {
            guard let viewController = self.bridge?.viewController else {
                call.reject("No view available to present the calendar editor.")
                return
            }

            let store = EKEventStore()
            let event = EKEvent(eventStore: store)
            event.title = title
            event.notes = description
            event.startDate = Date(timeIntervalSince1970: startMillis / 1000)
            event.endDate = Date(timeIntervalSince1970: endMillis / 1000)
            event.isAllDay = allDay

            let editViewController = EKEventEditViewController()
            editViewController.event = event
            editViewController.eventStore = store
            editViewController.editViewDelegate = self

            self.pendingCall = call
            viewController.present(editViewController, animated: true)
        }
    }

    public func eventEditViewController(
        _ controller: EKEventEditViewController,
        didCompleteWith action: EKEventEditViewAction
    ) {
        controller.dismiss(animated: true)
        // Resolved regardless of whether the person tapped Add or Cancel —
        // same fire-and-forget "handed off to the calendar flow" semantics
        // NativeCalendarPlugin.java's own call.resolve() already has right
        // after startActivity(), not gated on confirming the event was
        // actually saved.
        pendingCall?.resolve()
        pendingCall = nil
    }
}
