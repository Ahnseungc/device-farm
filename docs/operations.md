# 운영: 호스트 맥과 기기 준비

디바이스팜은 기기를 꽂아 둔 맥 한 대에서 돈다. 한 번만 한다.

## 1. 맥

```bash
sudo pmset -a disablesleep 1
sudo pmset -a sleep 0 displaysleep 10
brew install android-platform-tools libimobiledevice ffmpeg node
git clone <이 저장소> ~/device-farm
cd ~/device-farm && npm install
cp farm.config.example.ts farm.config.ts && cp .env.example .env
```

- 상시 충전 배터리가 부풀지 않게 충전 최적화(80% 상한)를 켠다. 기기는 전원 공급형 USB 허브에 꽂는다.
- 원격 로그인(SSH)을 켜고 Tailscale에 로그인해 두면 다른 PC에서 CLI를 쓸 수 있다.

## 2. Android

1. 개발자 옵션 → USB 디버깅 켜기, 이 맥을 신뢰.
2. `adb devices`에 `device`로 나오는지 본다.
3. 점검할 앱은 WebView 디버깅이 켜진 dev 빌드여야 한다. 디바이스팜은 `webview_devtools_remote_<pid>` 소켓을 포워딩해 CDP로 붙는다.
4. 화면 누르기는 실제 손가락과 같은 `adb shell input tap`으로 한다(네이티브가 덮은 하단 탭도 눌린다).

## 3. iOS

1. Xcode를 설치하고 한 번 열어 추가 구성요소를 깐다. 기기를 USB로 꽂고 신뢰, 개발자 모드를 켠다.
2. `xcrun devicectl list devices`에 `connected`로 나오는지 본다.
3. Appium:
   ```bash
   npm install -g appium
   appium driver install xcuitest
   ```
4. WebDriverAgent 서명(한 번). 기본 번들 id는 다른 팀과 겹쳐 실패하므로 내 팀 접두사로 바꾼다.
   ```bash
   cd ~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent
   xcodebuild build-for-testing -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
     -destination "id=<UDID>" -allowProvisioningUpdates \
     DEVELOPMENT_TEAM=<팀 id> CODE_SIGN_STYLE=Automatic \
     PRODUCT_BUNDLE_IDENTIFIER=<내 접두사>.WebDriverAgentRunner
   ```
   같은 값을 `farm.config.ts`의 `ios.teamId`·`ios.wdaBundleId`(또는 `.env`의 `IOS_TEAM_ID`·`IOS_WDA_BUNDLE_ID`)에 넣는다. 처음이면 기기 설정 > 일반 > VPN 및 기기 관리에서 개발자 앱을 신뢰한다.
5. 기기 설정 > Safari > 고급 > 웹 속성 검사기를 켠다. 앱 WebView는 `isInspectable`이 켜진 빌드여야 한다.
6. Appium은 상시 띄워 둔다(`APPIUM_URL`, 기본 `http://127.0.0.1:4723`). 디바이스팜은 기기당 세션 하나를 열어 두고 원격 조작 화면(MJPEG)도 그 세션에서 받는다.

## 4. 빌드 받기

- Firebase App Distribution: 서비스 계정 키 경로를 `FIREBASE_SERVICE_ACCOUNT`에, 앱 id를 `FIREBASE_APP_<ANDROID|IOS>_<DEV|PROD>` 또는 `install.firebase`에 넣는다. 받은 빌드는 `test-results/builds/`에 캐시한다.
- TestFlight: `install.sources.ios.dev = "testflight"`면 기기의 TestFlight 앱 「이전 빌드」에서 그 버전을 직접 깔고(`install.testflightDevAppName`), 설치된 버전이 맞을 때까지 기다린다. 새 빌드 감시는 App Store Connect API(`ASC_*`)로 읽기만 한다.
- 서버는 5분마다 새 빌드를 보고, 새 빌드가 나오면 그 플랫폼의 연결된 기기로 자동 점검한다.

## 5. 상시 실행

launchd 에이전트 두 개(Appium, `npm run dev`)를 `~/Library/LaunchAgents`에 두고 `launchctl load`한다. 예:

```xml
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.device-farm</string>
  <key>WorkingDirectory</key><string>/Users/<나>/device-farm</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/npm</string><string>run</string><string>dev</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/<나>/Library/Logs/device-farm/farm.log</string>
  <key>StandardErrorPath</key><string>/Users/<나>/Library/Logs/device-farm/farm.log</string>
</dict></plist>
```

## 6. 원격 접속

화면 서버는 127.0.0.1에만 열린다. 밖에서는 Tailscale로만 들어온다.

```bash
tailscale serve --bg 5173
```

`tailscale serve`가 붙이는 `Tailscale-User-Login` 헤더의 계정 도메인이 `access.allowedDomains`(또는 `FARM_ALLOWED_DOMAINS`)에 있어야 들어온다. 헤더도 프록시 흔적도 없는 127.0.0.1 요청(이 맥에서 직접, SSH CLI)은 들어온다. tailnet 밖 브라우저에서는 열리지 않아야 한다.

다른 PC에서:

```bash
ssh <맥> 'cd ~/device-farm && npm run device-run -- --build dev --version <버전>'
```

## 7. 보관

`test-results/devices/`의 실행 기록은 30일이 지나면 서버가 지운다. 기준 화면(`test-results/device-baselines/`)은 지우지 않는다.
