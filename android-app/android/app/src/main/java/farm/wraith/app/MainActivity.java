package farm.wraith.app;

import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

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
