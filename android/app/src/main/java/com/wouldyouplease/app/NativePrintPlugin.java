package com.wouldyouplease.app;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the web app's existing window.print()-based Print Reports feature
 * (every Print button in the app, all funneled through the one shared
 * printWithExpandedWindow() in app/src/lib/platform.ts) to Android's native
 * print system. A bare Capacitor WebView does not implement window.print()
 * on its own the way a full browser (Chrome, or the browser-installed PWA)
 * does -- 2026-10-16, first real-device test on a Galaxy S24+.
 *
 * Reuses WebView's own built-in createPrintDocumentAdapter(), which already
 * knows how to render the current page to a PDF for Android's print
 * subsystem -- no custom PDF rendering needed here. The only custom piece
 * is a thin delegating wrapper around that adapter, added purely to learn
 * the moment Android's print system is genuinely finished with it
 * (onFinish()), so this plugin's print() call -- and therefore the web
 * side's Promise -- only resolves once printing has truly ended (printed,
 * saved as PDF, or cancelled). PrintManager.print() itself returns
 * immediately once the dialog is launched, well before the user is done
 * with it; resolving right away (instead of waiting for onFinish()) would
 * risk the calling screen unmounting its own .print-report DOM content
 * (via its existing 'afterprint' listener, see platform.ts) before Android
 * has actually finished reading it to build the PDF.
 */
@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String jobName = call.getString("jobName", "Would You Please");

        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (webView == null) {
                call.reject("No WebView available to print.");
                return;
            }

            PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
                call.reject("Printing is not available on this device.");
                return;
            }

            PrintDocumentAdapter innerAdapter = webView.createPrintDocumentAdapter(jobName);

            PrintDocumentAdapter wrappedAdapter = new PrintDocumentAdapter() {
                @Override
                public void onLayout(
                    PrintAttributes oldAttributes,
                    PrintAttributes newAttributes,
                    CancellationSignal cancellationSignal,
                    LayoutResultCallback callback,
                    Bundle extras
                ) {
                    innerAdapter.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras);
                }

                @Override
                public void onWrite(
                    PageRange[] pages,
                    ParcelFileDescriptor destination,
                    CancellationSignal cancellationSignal,
                    WriteResultCallback callback
                ) {
                    innerAdapter.onWrite(pages, destination, cancellationSignal, callback);
                }

                @Override
                public void onFinish() {
                    innerAdapter.onFinish();
                    // Android's print framework is genuinely done with the
                    // adapter here -- printed, saved, or cancelled -- the
                    // one reliable "done" signal it offers an app.
                    call.resolve();
                }
            };

            try {
                printManager.print(jobName, wrappedAdapter, new PrintAttributes.Builder().build());
            } catch (Exception e) {
                call.reject("Could not start printing.", e);
            }
        });
    }
}
