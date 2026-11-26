package kr.baepu.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.SystemBarStyle;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Locale;

/**
 * 배프 앱 = web/ 폴더의 HTML을 앱 화면 전체에 띄우는 껍데기예요.
 *
 *  - web/ 파일은 https://appassets.androidplatform.net/assets/... 주소로 열려요.
 *    (file:// 대신 https 주소를 써야 저장소(localStorage)·토스 결제창 돌아오기가 웹에서처럼 동작해요)
 *  - 카카오페이·카드사 앱 같은 결제 앱 주소(intent://, ispmobile:// 등)는 그 앱을 열어요.
 *  - 새 창(target="_blank") 링크는 앱 위에 덮는 화면으로 열고, 위쪽 "닫고 배프로 돌아가기"로 닫아요.
 *  - 휴대폰 뒤로가기 버튼은 화면 왼쪽 위 "뒤로" 버튼과 똑같이 동작해요.
 */
public class MainActivity extends ComponentActivity {

    static final String APP_ORIGIN = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN;
    static final String START_URL = APP_ORIGIN + "/assets/index.html";

    /** 화면에 보이는 "뒤로" 버튼이 있으면 눌러요. 눌렀으면 true. */
    private static final String JS_PRESS_BACK =
            "(function(){try{var b=document.querySelector('#app [data-a=back]');"
            + "if(b&&b.offsetParent!==null&&!b.disabled){b.click();return true}}catch(e){}return false})()";

    private FrameLayout root;
    private WebView web;
    private final ArrayList<WebView> popups = new ArrayList<>();
    private WebViewAssetLoader assetLoader;
    private boolean clearHistoryAfterLoad = false;
    private long lastBackAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this,
                SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
                SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT));
        super.onCreate(savedInstanceState);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // 개발 중에는 PC 크롬 chrome://inspect 에서 앱 화면을 검사할 수 있어요.
            WebView.setWebContentsDebuggingEnabled(true);
        }

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.baep_bg));
        web = newWebView();
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // 상태바·내비게이션바·키보드에 화면이 가리지 않게 여백을 줘요.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBack();
            }
        });

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(START_URL);
        }
    }

    // ---------------------------------------------------------------- WebView

    @SuppressLint("SetJavaScriptEnabled")
    private WebView newWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage (로그인·저장)
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);            // target="_blank" → onCreateWindow
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);                           // 글씨 크기는 앱 안 "글자 크게" 버튼으로 조절
        s.setUserAgentString(s.getUserAgentString() + " BaepApp/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(w, true);  // 결제창(토스·카드사)에 필요

        w.setBackgroundColor(getColor(R.color.baep_bg));
        w.setWebViewClient(new AppClient());
        w.setWebChromeClient(new AppChrome());
        return w;
    }

    private class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return openOutside(view, request.getUrl());
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            // 결제를 마치고 앱으로 돌아오면(?toss=ok / ?toss=fail) 뒤로가기로 결제창에 다시 들어가지 않게 기록을 지워요.
            if (view == web && url != null && url.startsWith(APP_ORIGIN) && url.contains("toss=")) {
                clearHistoryAfterLoad = true;
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view == web && clearHistoryAfterLoad) {
                clearHistoryAfterLoad = false;
                view.clearHistory();
            }
        }
    }

    private class AppChrome extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView child = openPopup();
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(child);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onCloseWindow(WebView window) {
            closePopup(window);
        }
    }

    // ------------------------------------------------- 결제 앱·전화·문자 등 바깥 앱

    /** http(s)가 아닌 주소면 알맞은 앱을 열고 true. http(s)면 false(웹뷰 안에서 열기). */
    private boolean openOutside(WebView view, Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        switch (scheme) {
            case "http":
            case "https":
            case "about":
            case "data":
            case "blob":
            case "javascript":
            case "file":
                return false;
            default:
                break;
        }

        if ("intent".equals(scheme)) {
            Intent intent;
            try {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
            } catch (URISyntaxException e) {
                return true;
            }
            intent.setComponent(null);
            intent.setSelector(null);
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException e) {
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null && (fallback.startsWith("https://") || fallback.startsWith("http://"))) {
                    view.loadUrl(fallback);
                } else if (intent.getPackage() != null) {
                    openStore(intent.getPackage());   // 결제 앱이 없으면 플레이스토어로
                } else {
                    toast(R.string.no_app_found);
                }
            }
            return true;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));  // tel:, sms:, mailto:, market:, 카드사 앱 등
        } catch (ActivityNotFoundException e) {
            if ("ispmobile".equals(scheme)) {
                openStore("kvp.jjy.MispAndroid320");          // ISP/페이북
            } else if ("kftc-bankpay".equals(scheme)) {
                openStore("com.kftc.bankpay.android");        // 뱅크페이
            } else {
                toast(R.string.no_app_found);
            }
        }
        return true;
    }

    private void openStore(String pkg) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)));
            } catch (ActivityNotFoundException ignored) {
                toast(R.string.no_app_found);
            }
        }
    }

    // ------------------------------------------------------- 새 창(덮는 화면)

    private WebView openPopup() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(Color.WHITE);
        box.setClickable(true);   // 아래 앱 화면이 눌리지 않게

        WebView child = newWebView();

        TextView bar = new TextView(this);
        bar.setText(R.string.popup_close);
        bar.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        bar.setTypeface(Typeface.DEFAULT_BOLD);
        bar.setTextColor(getColor(R.color.baep_blue_ink));
        bar.setBackgroundColor(getColor(R.color.baep_sky_light));
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setMinHeight(dp(56));
        bar.setPadding(dp(18), dp(12), dp(18), dp(12));
        bar.setOnClickListener(v -> closePopup(child));

        View line = new View(this);
        line.setBackgroundColor(getColor(R.color.baep_line));

        box.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        box.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        box.addView(child, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        root.addView(box, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        popups.add(child);
        return child;
    }

    private void closePopup(WebView child) {
        if (!popups.remove(child)) return;
        View box = (View) child.getParent();
        if (box != null) root.removeView(box);
        child.stopLoading();
        child.destroy();
    }

    // ---------------------------------------------------------------- 뒤로가기

    private void handleBack() {
        if (!popups.isEmpty()) {
            WebView top = popups.get(popups.size() - 1);
            if (top.canGoBack()) top.goBack();
            else closePopup(top);
            return;
        }
        web.evaluateJavascript(JS_PRESS_BACK, result -> {
            if ("true".equals(result)) return;
            if (web.canGoBack()) {
                web.goBack();
                return;
            }
            long now = SystemClock.elapsedRealtime();
            if (now - lastBackAt < 2000) {
                finish();
            } else {
                lastBackAt = now;
                toast(R.string.press_again_to_exit);
            }
        });
    }

    // ---------------------------------------------------------------- 수명주기

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        for (WebView p : new ArrayList<>(popups)) closePopup(p);
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- 도우미

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void toast(int res) {
        Toast.makeText(this, res, Toast.LENGTH_SHORT).show();
    }
}
