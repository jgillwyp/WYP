package com.wouldyouplease.app;

import android.content.Intent;
import android.provider.CalendarContract;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the web app's existing "Add to Calendar" button
 * (RequestResponseForm.tsx, ResponseDetailForm.tsx) to a real native
 * calendar event on Android, replacing the .ics-Blob-download path used on
 * the web/PWA there -- unreliable on Android per this project's own earlier
 * investigation (opening a downloaded .ics and tapping its own "Add" link
 * has silently done nothing in some Android/METHOD combinations;
 * 2026-10-16, built alongside NativePrintPlugin for the same real-device
 * test).
 *
 * Uses Intent.ACTION_INSERT against CalendarContract.Events.CONTENT_URI --
 * the standard "hand off to the user's own Calendar app" pattern, which
 * needs no WRITE_CALENDAR/READ_CALENDAR runtime permission at all (the
 * Calendar app itself performs the actual write, once the person reviews
 * and taps Save there, same as tapping a .ics attachment already does
 * today). Deliberate trade-off, not an oversight: this means the alarm
 * offsets the existing AddToCalendarAlarmsDialog.tsx lets a person choose
 * (embedded as VALARM entries on the .ics path) can't be pre-set here --
 * there is no public Intent extra for it -- so the web side skips that
 * dialog entirely on native and calls this plugin directly
 * (handleAddToCalendar() in both React components). Whatever reminder the
 * Calendar app itself defaults to applies instead; the person can still add
 * one manually before tapping Save there.
 */
@CapacitorPlugin(name = "NativeCalendar")
public class NativeCalendarPlugin extends Plugin {

    @PluginMethod
    public void addEvent(PluginCall call) {
        String title = call.getString("title", "");
        String description = call.getString("description", "");
        Long startMillis = call.getLong("startMillis");
        Long endMillis = call.getLong("endMillis");
        boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));

        if (startMillis == null || endMillis == null) {
            call.reject("startMillis and endMillis are required.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.Events.DESCRIPTION, description)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMillis)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMillis)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay);

        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("No calendar app is available on this device.");
            return;
        }

        getActivity().startActivity(intent);
        call.resolve();
    }
}
