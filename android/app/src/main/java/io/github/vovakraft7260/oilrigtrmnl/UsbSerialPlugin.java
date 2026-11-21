package io.github.vovakraft7260.oilrigtrmnl;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;

/**
 * Minimal USB serial (CDC-ACM) link to a Flipper Zero plugged into the phone.
 * JS gets "data" events (base64) and a "disconnected" event.
 */
@CapacitorPlugin(name = "UsbSerial")
public class UsbSerialPlugin extends Plugin {
    private static final String ACTION_PERMISSION = "io.github.vovakraft7260.oilrigtrmnl.USB_PERMISSION";
    private static final int FLIPPER_VID = 0x0483;

    private UsbDeviceConnection connection;
    private UsbInterface controlIface;
    private UsbInterface dataIface;
    private UsbEndpoint in;
    private UsbEndpoint out;
    private Thread reader;
    private volatile boolean running;
    private UsbDevice openDevice;
    private PluginCall pendingConnect;

    private UsbManager manager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_PERMISSION.equals(action)) {
                PluginCall call = pendingConnect;
                pendingConnect = null;
                if (call == null) return;
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (!granted || device == null) {
                    call.reject("USB permission was not given.");
                    return;
                }
                open(call, device);
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (openDevice != null && device != null && device.getDeviceId() == openDevice.getDeviceId()) {
                    close();
                    notifyListeners("disconnected", new JSObject());
                }
            }
        }
    };

    @Override
    public void load() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        close();
        try {
            getContext().unregisterReceiver(receiver);
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray arr = new JSArray();
        for (UsbDevice d : manager().getDeviceList().values()) {
            JSObject o = new JSObject();
            o.put("deviceId", d.getDeviceId());
            o.put("vendorId", d.getVendorId());
            o.put("productId", d.getProductId());
            o.put("name", d.getProductName() != null ? d.getProductName() : d.getDeviceName());
            o.put("flipper", d.getVendorId() == FLIPPER_VID);
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        UsbDevice device = null;
        Integer wanted = call.getInt("deviceId");
        for (UsbDevice d : manager().getDeviceList().values()) {
            if (wanted != null ? d.getDeviceId() == wanted : d.getVendorId() == FLIPPER_VID) {
                device = d;
                break;
            }
        }
        if (device == null) {
            call.reject("No Flipper found on USB. Plug it in with a USB-C cable (data cable, not charge-only).");
            return;
        }
        if (manager().hasPermission(device)) {
            open(call, device);
            return;
        }
        pendingConnect = call;
        Intent intent = new Intent(ACTION_PERMISSION).setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        manager().requestPermission(device, PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void open(PluginCall call, UsbDevice device) {
        close();
        controlIface = null;
        dataIface = null;
        in = null;
        out = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            if (iface.getInterfaceClass() == UsbConstants.USB_CLASS_COMM && controlIface == null) controlIface = iface;
            if (iface.getInterfaceClass() == UsbConstants.USB_CLASS_CDC_DATA && dataIface == null) {
                for (int e = 0; e < iface.getEndpointCount(); e++) {
                    UsbEndpoint ep = iface.getEndpoint(e);
                    if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                    if (ep.getDirection() == UsbConstants.USB_DIR_IN) in = ep;
                    else out = ep;
                }
                if (in != null && out != null) dataIface = iface;
            }
        }
        if (dataIface == null) {
            call.reject("This USB device isn't a serial port. Is the Flipper in normal mode?");
            return;
        }
        connection = manager().openDevice(device);
        if (connection == null) {
            call.reject("Couldn't open the USB connection.");
            return;
        }
        if (controlIface != null) connection.claimInterface(controlIface, true);
        connection.claimInterface(dataIface, true);
        int ctrlIndex = controlIface != null ? controlIface.getId() : 0;
        // 115200 8N1, then DTR + RTS on: the Flipper starts its CLI when DTR is set.
        byte[] lineCoding = new byte[] {0x00, (byte) 0xC2, 0x01, 0x00, 0x00, 0x00, 0x08};
        connection.controlTransfer(0x21, 0x20, 0, ctrlIndex, lineCoding, lineCoding.length, 1000);
        connection.controlTransfer(0x21, 0x22, 0x03, ctrlIndex, null, 0, 1000);
        openDevice = device;
        running = true;
        final UsbDeviceConnection conn = connection;
        final UsbEndpoint readEp = in;
        reader = new Thread(() -> {
            byte[] buf = new byte[Math.max(readEp.getMaxPacketSize(), 16384)];
            while (running) {
                int n = conn.bulkTransfer(readEp, buf, buf.length, 200);
                if (n > 0) {
                    JSObject ev = new JSObject();
                    ev.put("data", Base64.encodeToString(Arrays.copyOf(buf, n), Base64.NO_WRAP));
                    notifyListeners("data", ev);
                } else if (n < 0 && openDevice == null) {
                    break;
                }
            }
        }, "flipper-usb-read");
        reader.start();
        JSObject ret = new JSObject();
        ret.put("name", device.getProductName() != null ? device.getProductName() : "Flipper");
        call.resolve(ret);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String b64 = call.getString("data");
        if (connection == null || out == null || b64 == null) {
            call.reject("USB not connected");
            return;
        }
        byte[] data = Base64.decode(b64, Base64.NO_WRAP);
        int off = 0;
        while (off < data.length) {
            int n = Math.min(16384, data.length - off);
            int sent = connection.bulkTransfer(out, Arrays.copyOfRange(data, off, off + n), n, 5000);
            if (sent <= 0) {
                call.reject("USB write failed");
                return;
            }
            off += sent;
        }
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        close();
        call.resolve();
    }

    private void close() {
        running = false;
        if (reader != null) {
            try {
                reader.join(500);
            } catch (InterruptedException ignored) {
            }
            reader = null;
        }
        if (connection != null) {
            try {
                if (controlIface != null) {
                    connection.controlTransfer(0x21, 0x22, 0x00, controlIface.getId(), null, 0, 200);
                    connection.releaseInterface(controlIface);
                }
                if (dataIface != null) connection.releaseInterface(dataIface);
            } catch (Exception ignored) {
            }
            connection.close();
            connection = null;
        }
        openDevice = null;
    }
}
