package com.wouldyouplease.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Local custom plugins (not npm packages) -- NativePrintPlugin.java and
    // NativeCalendarPlugin.java, both added 2026-10-16. Must be registered
    // before super.onCreate(), which is where Capacitor's own bridge
    // actually wires plugins up.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePrintPlugin.class);
        registerPlugin(NativeCalendarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
