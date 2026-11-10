# Wraith Android app

A real Android app (Capacitor). It shows `https://www.wraith.farm/app` inside the app's own window, so there is no
browser address bar, no browser menus, and no Chrome in between. Website changes show up without reinstalling.
Only rebuild the APK when something native changes (icon, plugins, Firebase).

The website recognises the app by its user agent (`WraithApp`), so the "download the app" screen never shows inside it.

## Build

Needs Android Studio (for its bundled Java and the SDK). From this folder:

```powershell
npm install
node scripts/make-icons.mjs          # run from the repo root: node android-app/scripts/make-icons.mjs
npx cap sync android
cd android
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleRelease
```

The signed APK is `android/app/build/outputs/apk/release/app-release.apk`. Copy it to `public/downloads/wraith.apk`
to update the download button on the website.

## Signing key (do not lose it)

`wraith-release.keystore` and `keystore.properties` are in this folder and are git-ignored. Back both up somewhere safe
(password manager, private drive). Without that key you cannot publish an update that installs over this app.

## Push notifications

`android/app/google-services.json` (git-ignored) holds the Firebase settings for project `wraith-app-a0d57`. With that file
present the build turns push on (`prepare-config.mjs` adds `WraithPush` to the user agent) and the app asks for notification
permission once you are signed in. Without the file push stays off, because the push plugin crashes the app when Firebase is missing.

## Sign-in

Google only. Google refuses to show its sign-in page inside an app window, so the app opens it in an in-app Chrome sheet
(Custom Tab). When Google finishes, the page sends you back to the app with an Android intent (`OpenInApp`), or through the
verified link when Android has verified it.
