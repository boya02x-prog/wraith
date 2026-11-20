package farm.wraith.app;

import android.app.Activity;

import androidx.annotation.RequiresApi;

/**
 * Android 14+ tells an open app when the user takes a screenshot (no permission prompt, only the normal DETECT_SCREEN_CAPTURE
 * permission in the manifest). Kept in its own class so older phones never load the Android 14 types.
 * Some phone makers (Xiaomi among them) draw their own screenshot tool that does not report to this call; MainActivity
 * has a second detector for those, which needs the person to allow photo access once.
 */
@RequiresApi(34)
final class ScreenshotWatcher {
    private final Activity activity;
    private final Runnable onShot;
    private Activity.ScreenCaptureCallback callback;

    ScreenshotWatcher(Activity activity, Runnable onShot) {
        this.activity = activity;
        this.onShot = onShot;
    }

    void start() {
        if (callback != null) return;
        Activity.ScreenCaptureCallback cb = onShot::run;
        try {
            activity.registerScreenCaptureCallback(activity.getMainExecutor(), cb);
            callback = cb;
        } catch (Exception ignored) {
            // the permission is missing or the system refused: the other detector can still work
        }
    }

    void stop() {
        if (callback == null) return;
        try {
            activity.unregisterScreenCaptureCallback(callback);
        } catch (Exception ignored) {
            // already gone
        }
        callback = null;
    }
}
