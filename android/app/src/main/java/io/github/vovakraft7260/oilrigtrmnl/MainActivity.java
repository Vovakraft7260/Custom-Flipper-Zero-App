package io.github.vovakraft7260.oilrigtrmnl;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsbSerialPlugin.class); // Flipper over a USB-C cable
        super.onCreate(savedInstanceState);
    }
}
