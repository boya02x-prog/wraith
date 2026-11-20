package farm.wraith.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    // System bar sizes in CSS pixels, handed to the page so its header and tab bar can sit clear of the bars
    // while the content itself scrolls behind them (works the same with gesture navigation and 3-button navigation).
    private volatile String insetsJson = "{\"t\":0,\"b\":0,\"l\":0,\"r\":0}";

    // Screenshot detection, which opens the share studio on its own (like Fomo). Two detectors, because phone makers differ:
    //  1) Android 14+ tells an open app about screenshots by itself (ScreenshotWatcher, no prompt);
    //  2) a watcher on new pictures catches the rest, but only after the person allows photo access (the page asks for it by calling WraithShot.enable()).
    // Either one sends the page a "wraith-screenshot" event; two reports of the same screenshot count once.
    private static final int REQ_MEDIA = 4107;
    private Object screenshotWatcher; // a ScreenshotWatcher, held as Object so phones older than Android 14 never load that class
    private ContentObserver shotObserver;
    private long lastShotAt = 0;

    private void fireScreenshot() {
        long now = System.currentTimeMillis();
        if (now - lastShotAt < 2500) return;
        lastShotAt = now;
        final WebView w = bridge.getWebView();
        w.post(() -> w.evaluateJavascript("window.dispatchEvent(new CustomEvent('wraith-screenshot'))", null));
    }

    private String mediaPermission() {
        return Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    private boolean hasMediaAccess() {
        return checkSelfPermission(mediaPermission()) == PackageManager.PERMISSION_GRANTED;
    }

    private void startShotObserver() {
        if (shotObserver != null || !hasMediaAccess()) return;
        shotObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange, Uri uri) {
                super.onChange(selfChange, uri);
                if (newestPictureIsScreenshot()) fireScreenshot();
            }
        };
        try {
            getContentResolver().registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, shotObserver);
        } catch (Exception e) {
            shotObserver = null;
        }
    }

    private void stopShotObserver() {
        if (shotObserver == null) return;
        try {
            getContentResolver().unregisterContentObserver(shotObserver);
        } catch (Exception ignored) {
            // already gone
        }
        shotObserver = null;
    }

    /** True when the newest picture on the phone was added a moment ago and has "screenshot" in its name or folder. */
    private boolean newestPictureIsScreenshot() {
        String where = Build.VERSION.SDK_INT >= 29 ? MediaStore.Images.Media.RELATIVE_PATH : MediaStore.Images.Media.DATA;
        String[] cols = { MediaStore.Images.Media.DISPLAY_NAME, where, MediaStore.Images.Media.DATE_ADDED };
        Cursor c = null;
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                Bundle args = new Bundle();
                args.putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, new String[]{ MediaStore.Images.Media.DATE_ADDED });
                args.putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION, ContentResolver.QUERY_SORT_DIRECTION_DESCENDING);
                args.putInt(ContentResolver.QUERY_ARG_LIMIT, 1);
                c = getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols, args, null);
            } else {
                c = getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC");
            }
            if (c == null || !c.moveToFirst()) return false;
            String name = c.getString(0), path = c.getString(1);
            long addedSeconds = c.getLong(2);
            if (Math.abs(System.currentTimeMillis() / 1000 - addedSeconds) > 15) return false;
            String text = ((name == null ? "" : name) + " " + (path == null ? "" : path)).toLowerCase(java.util.Locale.ROOT);
            return text.contains("screenshot") || text.contains("screen_shot") || text.contains("screencap");
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.close();
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        if (Build.VERSION.SDK_INT >= 34) {
            if (screenshotWatcher == null) screenshotWatcher = new ScreenshotWatcher(this, this::fireScreenshot);
            ((ScreenshotWatcher) screenshotWatcher).start();
        }
        startShotObserver(); // only does something when photo access was already allowed
    }

    @Override
    public void onStop() {
        super.onStop();
        if (Build.VERSION.SDK_INT >= 34 && screenshotWatcher != null) ((ScreenshotWatcher) screenshotWatcher).stop();
        stopShotObserver();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MEDIA && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) startShotObserver();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Edge to edge: the page is drawn under transparent status and navigation bars.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightNavigationBars(false);

        final WebView web = bridge.getWebView();
        final float density = getResources().getDisplayMetrics().density;

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String get() { return insetsJson; }
        }, "WraithInsets");

        // The page can ask what screenshot detection is available and ask for the photo access the second detector needs.
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String status() {
                return "{\"callback\":" + (Build.VERSION.SDK_INT >= 34) + ",\"media\":" + hasMediaAccess() + "}";
            }

            @JavascriptInterface
            public void enable() {
                runOnUiThread(() -> {
                    if (hasMediaAccess()) startShotObserver();
                    else requestPermissions(new String[]{ mediaPermission() }, REQ_MEDIA);
                });
            }

            @JavascriptInterface
            public void test() {
                runOnUiThread(() -> fireScreenshot());
            }
        }, "WraithShot");

        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, windowInsets) -> {
            Insets b = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            insetsJson = "{\"t\":" + Math.round(b.top / density) + ",\"b\":" + Math.round(b.bottom / density)
                + ",\"l\":" + Math.round(b.left / density) + ",\"r\":" + Math.round(b.right / density) + "}";
            final String js = "(function(){try{var i=" + insetsJson + ",d=document.documentElement;"
                + "d.style.setProperty('--wx-top',i.t+'px');d.style.setProperty('--wx-bottom',i.b+'px');"
                + "d.style.setProperty('--wx-left',i.l+'px');d.style.setProperty('--wx-right',i.r+'px');}catch(e){}})()";
            web.post(() -> web.evaluateJavascript(js, null));
            return ViewCompat.onApplyWindowInsets(v, windowInsets);
        });

        // Google refuses to show its sign-in page inside an app window. Open it in an in-app sheet (Chrome Custom Tab)
        // instead of the full browser, the same way other apps do. Everything else behaves as before.
        web.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost() == null ? "" : url.getHost();
                if (host.equals("accounts.google.com") || host.endsWith(".accounts.google.com")
                    || host.equals("x.com") || host.endsWith(".x.com") || host.equals("twitter.com") || host.endsWith(".twitter.com")) {
                    CustomTabsIntent tab = new CustomTabsIntent.Builder()
                        .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder()
                            .setToolbarColor(Color.parseColor("#0C0C0D")).build())
                        .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
                        .setShowTitle(true)
                        .build();
                    tab.launchUrl(MainActivity.this, url);
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }
}
