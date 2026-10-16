import { registerPlugin } from '@capacitor/core'

/**
 * Local custom Capacitor plugin (android/app/src/main/java/com/wouldyouplease/app/
 * NativeCalendarPlugin.java) bridging the web app's existing "Add to
 * Calendar" button (RequestResponseForm.tsx, ResponseDetailForm.tsx) to a
 * real native calendar event via Android's own Intent.ACTION_INSERT, instead
 * of the .ics-Blob-download path used on the web/PWA -- that path has been
 * unreliable on Android (see NativeCalendarPlugin.java's own header comment).
 *
 * Deliberately not called with the .ics-generation's own VALARM alarm
 * choices (AddToCalendarAlarmsDialog.tsx) -- there's no public Intent extra
 * for pre-setting a reminder this way, so both call sites skip that dialog
 * entirely on native and call this directly.
 */
export interface NativeCalendarPlugin {
  addEvent(options: {
    title: string
    description: string
    startMillis: number
    endMillis: number
    allDay: boolean
  }): Promise<void>
}

const NativeCalendar = registerPlugin<NativeCalendarPlugin>('NativeCalendar')

export default NativeCalendar
