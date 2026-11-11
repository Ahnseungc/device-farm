# device-farm

[![npm](https://img.shields.io/npm/v/@ahnseungchan/device-farm)](https://www.npmjs.com/package/@ahnseungchan/device-farm)
[![CI](https://github.com/Ahnseungc/device-farm/actions/workflows/ci.yml/badge.svg)](https://github.com/Ahnseungc/device-farm/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/Ahnseungc/device-farm/blob/main/LICENSE)

**A device farm that runs QA on real phones for mobile apps built with WebViews. Install it in your project and describe your app in one `farm.config.ts`.**

<p align="center">
  <a href="https://ahnseungc.github.io/device-farm/"><img src="https://raw.githubusercontent.com/Ahnseungc/device-farm/main/docs/assets/demo.gif" width="800" alt="device-farm demo: device list, a failed screen compared with its baseline, the screen map, chaos candidate weights, and extracted policy rules" /></a>
</p>

<p align="center">
  <b><a href="https://ahnseungc.github.io/device-farm/">Live demo →</a></b> (fixture data for a fictional "Sample Shop" app, no server or device needed, read-only)
</p>

The app under test is not in the code. Package ids, web origins, bottom tabs, forbidden words, and scenarios are all **injected** through `farm.config.ts`.
Android is driven with adb + Chrome DevTools Protocol (Playwright), iOS with Appium (XCUITest, WebDriverAgent), both inside the app's WebView.

[한국어 문서](https://github.com/Ahnseungc/device-farm/blob/main/docs/README.ko.md)

## Features

- **Build checks**: watch for new builds → install → check fixed screens. Fails on app error text, login bounce, blank screens, or a pixel diff against the baseline.
- **Button check and screen map**: records how every button reacts and stitches screens together into a map. Build flows by chaining map blocks.
- **Flows**: scenarios that start at home and move only by tapping buttons and links. Record them, assemble them from the map, or generate candidates from a PRD with an LLM (optional).
- **Data QA**: re-calls the GET APIs a screen uses and checks totals and displayed values with plain rules (no LLM).
- **Exploration and chaos**: breadth-first exploration, plus seeded chaos (back, double tap, back while loading, background, restart).
- **Policy and Figma checks**: detects Confluence policy changes, extracts rules, and compares Figma copy.
- **Remote control**: watch the device screen in the browser (Android H.264, iOS MJPEG) and tap it yourself. A device you control is locked for others.
- **Claude Code (MCP)**: Claude explores the device through MCP tools and turns the paths it finds into flow candidates.

## Install

```bash
npm install -D @ahnseungchan/device-farm
```

| Requirement                                                                       | When                         |
| --------------------------------------------------------------------------------- | ---------------------------- |
| macOS, Node.js 22+                                                                | Always                       |
| `adb` (Android platform-tools) and a device with USB debugging on                 | Android                      |
| A dev build with WebView debugging: `WebView.setWebContentsDebuggingEnabled(true)` | Android                      |
| Xcode, Appium + XCUITest driver (WebDriverAgent), a build with `isInspectable = true` | iOS                      |
| Firebase service account, App Store Connect API key                               | Auto-installing new builds (optional) |
| Confluence API token, Figma token                                                 | Policy and Figma checks (optional) |

Host Mac and device setup: [docs/operations.md](https://github.com/Ahnseungc/device-farm/blob/main/docs/operations.md) (Korean)

<details>
<summary><b>What the app under test needs</b></summary>

1. A build with **WebView debugging** on. device-farm connects through that debugging socket.
2. **Path deep links**: `<scheme>://<web path>` opens that web path in the WebView.
3. **Bottom tabs are web links** (`a[href]` or `role=link`), and the in-page back button has a name (`aria-label`).
4. A test account that is already signed in. If a screen bounces to login, it is reported as "login required".

</details>

## Quick start

```bash
npx device-farm init   # creates farm.config.ts and .env.example (skips files that exist)
npx device-farm dev    # http://127.0.0.1:5173 (change with --port)
```

Edit the `farm.config.ts` that `init` created. With only the required fields it looks like this:

```ts
// farm.config.ts
import { defineAppConfig } from "@ahnseungchan/device-farm";

export default defineAppConfig({
  name: "My App",
  appIds: { dev: "com.example.app.dev", prod: "com.example.app" },
  web: { dev: "https://dev.app.example.com", prod: "https://app.example.com" },
  homePath: "/home",
  homeTabName: "Home",
  tabPaths: { Search: "/search", My: "/my" },
  deepLink: { scheme: "myapp", homeHost: "home" },
});
```

If you need tokens, copy `.env.example` to `.env` and fill it in. Add `.env` and `test-results/` to `.gitignore`.
Everything the farm produces (run history, screenshots, baselines, the screen map) goes to `test-results/` in your working directory.

<details>
<summary><b>Data QA rule example</b></summary>

```ts
import { defineAppConfig, formatWon, numberAt, textHas } from "@ahnseungchan/device-farm";

export default defineAppConfig({
  // ...required fields
  apiOrigin: "https://api-dev.app.example.com",
  qa: {
    sessionPath: "/api/auth/session",
    screens: [
      {
        path: "/cart",
        name: "Cart",
        apis: { cart: "/v1/users/{userId}/cart" },
        rules: [
          {
            id: "total-shown",
            title: "The total from the API is shown on screen",
            check: (context) => {
              const shown = `${formatWon(numberAt(context, "cart", "totalWon"))}원`;
              return textHas(context.text, shown) ? null : `Not on screen: total "${shown}"`;
            },
          },
        ],
      },
    ],
  },
});
```

Run it with `npx device-farm qa --device <id> [--path /cart]`. The full example is in the `farm.config.ts` that `init` creates.

</details>

## Configuration

`defineAppConfig()` fills in defaults for anything you leave out. The `AppConfigInput` and `AppConfig` types are exported from the package.
The config file is resolved as `FARM_CONFIG` → `farm.config.ts` in the working directory → `farm.config.example.ts`. Secrets are read from `.env` in the working directory.

| Field                               | Required | What it is                                                                         |
| ----------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `name`                              | ✓        | App name, used in the UI title and prompts                                         |
| `appIds`                            | ✓        | `{ dev, prod }` Android package = iOS bundle id. Use `iosBundleIds` if they differ |
| `homePath`, `homeTabName`, `tabPaths` | ✓      | Home path, home tab name, and bottom tab name → path                               |
| `web`                               |          | `{ dev, prod }` WebView origins. Falls back to `FARM_WEB_ORIGIN_DEV` / `FARM_WEB_ORIGIN_PROD` |
| `apiOrigin`                         |          | API host when it differs from the web origin. The guard treats it as internal, and data QA calls it |
| `deepLink`                          |          | `{ scheme, homeHost }` for path deep links                                         |
| `guard`                             |          | Words and API patterns **added** to the built-in deny lists, and `pushTokenRequests` that always pass |
| `scenarios`, `excludedScenarioPaths` |         | Fixed screens to check, and paths to skip                                          |

<details>
<summary><b>All fields</b></summary>

| Field                       | What it is                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inPageBackNames`           | Names of the in-page back button. Default `["뒤로가기", "Back"]`                                                                                                       |
| `loginPaths`, `appErrorText` | Login screen paths and the app's error text. Default `["/login"]`, `"Application error"`                                                                             |
| `android.mainActivity`      | The WebView activity. If another native screen is on top, it is closed with the back key                                                                              |
| `webview`                   | `stackResetScript` (bridge call that closes the WebView stack), `sheetCloseName` (bottom sheet close button)                                                          |
| `guard`                     | `extraForbiddenButtonWords`, `extraForbiddenClickNames`, `extraForbiddenApiPatterns`, `pushTokenRequests`, and `avoidedNamePattern` / `noPressPathPattern` to never press |
| `qa`                        | `{ screens, sessionPath }`: data QA screens and rules, and the signed-in session path                                                                                 |
| `policy.confluence`         | `{ cloudId, spaceKey, titleQuery, siteUrl }`: where the policy docs live                                                                                             |
| `figma`                     | `{ frontRepo, ref, appDir }`: the front-end checkout used to map screens to Figma nodes                                                                               |
| `install`                   | `sources` (`firebase` / `testflight` per platform and build), `firebase` (app ids), `testflightDevAppName`                                                            |
| `ios`                       | `{ teamId, wdaBundleId }` for WDA signing. Falls back to `IOS_TEAM_ID` / `IOS_WDA_BUNDLE_ID`                                                                          |
| `access.allowedDomains`     | Tailscale account domains allowed to open the UI. Empty means this Mac only                                                                                           |

The data QA helpers `equalWon`, `formatWon`, `numberAt`, `textHas`, and `pick` are exported from the package root. Environment variables are listed in `.env.example`.

</details>

## CLI

Every command reads config and `.env` from the working directory (your project) and writes results there. Run `npx device-farm <command> --help` for options.

| Command                                              | What it does                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `device-farm init`                                   | Create `farm.config.ts` and `.env.example`                           |
| `device-farm dev [--port 5173]`                      | UI + API server on 127.0.0.1. New-build and policy watchers run with it |
| `device-farm check --build dev\|prod --version 2.1.5` | Ask the running server for a build check and print progress until it ends |
| `device-farm explore`                                | Exploration check (needs the server)                                 |
| `device-farm chaos --device <serial>`                | Chaos exploration (Android dev)                                      |
| `device-farm record --device <serial>`               | Record a person's actions → screen map and flow candidates           |
| `device-farm qa --device <id>`                       | Data QA only                                                         |
| `device-farm policy-watch`                           | Detect policy changes, extract rules, cache Figma copy               |
| `device-farm policy-check --device <id>`             | Policy and Figma comparison on one device                            |
| `device-farm explore-allowlist`                      | Add write APIs from OpenAPI (`FARM_OPENAPI_URL`) to the allowlist as deny |
| `device-farm mcp`                                    | MCP server for Claude Code (stdio)                                   |

<details>
<summary><b>Options per command</b></summary>

```bash
device-farm dev [--port 5173]
device-farm check --build dev|prod --version 2.1.5 [--devices all|id,id] [--port 5173]
device-farm explore [--devices all|id,id] [--build dev] [--port 5173]
device-farm chaos --device <Android serial> [--seed 42] [--episodes 3] [--steps 50] [--minutes 60] [--no-guard]
device-farm record --device <Android serial> [--seconds 300] [--name "flow name"]
device-farm qa --device <id> [--path /cart]
device-farm policy-watch [--extract <pageId>] [--figma]
device-farm policy-check --device <id> [--path /my/orders]
```

`check` and `explore` send work to a running `dev` server. If you changed the port, pass the same `--port`.
Keep the exploration allowlist `explore/allowlist.json`, input test values `explore/form-values.json`, and policy sources `policy/sources.json` in your working directory and commit them. Without an allowlist, every write request is blocked.

</details>

## Claude Code (MCP)

```bash
# in your project folder
claude mcp add --scope project device-farm -- npx device-farm mcp
```

- Tool flow: `device_start` → `device_look` / `device_press` / `device_go_home` / `device_report_issue` → `device_finish`.
- When it finishes, results are merged into the screen map, and paths that can be replayed from home become flow candidates. The report is written to `test-results/agent/<time>/report.json`.
- Exploration runs only on Android dev builds with the write-request guard on. It runs on your Claude Code account; no API key is needed.

This repository also works as a Claude Code plugin (`.claude-plugin`, skills `run-check`, `chaos-explore`, `policy-figma-check`). Clone it, run `npm install`, and add it as a plugin.

## Safety

- Exploration, button checks, chaos, and MCP exploration run on **Android dev builds** with the write-request guard on. If the guard cannot attach, they do not start (fail closed).
- Guard order: reads (GET, HEAD, OPTIONS) pass → `pushTokenRequests` pass → forbidden paths are blocked → allowlist `allow` passes → `deny` and unknown are blocked.
- Built-in forbidden buttons (buy, pay, sell, transfer, withdraw, delete account, order, refund, cancel, delete, log out, and more) are removed from the candidate list and refused if pressed. App config can only add forbidden words, never remove them. Password and PIN screens are never pressed, only left.
- `chaos --no-guard` does not block write requests. Use it **only against a dev server**. Forbidden buttons are still never pressed.
- The UI server listens on 127.0.0.1 only. Remote access goes through `tailscale serve`, limited to `access.allowedDomains`.

## FAQ

<details>
<summary><b>Can I open the UI without a device?</b></summary>

Yes. `npx device-farm init && npx device-farm dev` opens the UI with the example config. The device list is empty and no checks run.
To see the UI filled with data, open the [live demo](https://ahnseungc.github.io/device-farm/).

</details>

<details>
<summary><b>Does iOS support exploration and chaos?</b></summary>

Build checks and remote control support iOS (Appium). Exploration, chaos, recording, and MCP exploration support Android dev builds only for now.

</details>

<details>
<summary><b>Why is the UI in Korean?</b></summary>

It was built for a Korean team first. The CLI help and UI text are Korean for now; an English UI PR is welcome.

</details>

<details>
<summary><b><code>check</code> says it cannot reach the server.</b></summary>

`check` and `explore` send work to a running `device-farm dev` server. Start `dev` in another terminal first, and pass the same `--port` if you changed it.

</details>

<details>
<summary><b>Do I need an LLM API key?</b></summary>

No. Checks, exploration, chaos, and data QA are judged by rules only. An LLM is used only to generate flow candidates from a PRD (`FLOW_LLM_*`) and to judge policy behavior rules.

</details>

## Docs

Design notes are in Korean for now.

- [Operations: host Mac and device setup](https://github.com/Ahnseungc/device-farm/blob/main/docs/operations.md)
- [Design: build checks, baselines, flows, screen map](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-device-farm.md)
- [Design: exploration and the write-request guard](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-explore.md)
- [Design: chaos exploration](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-chaos.md)
- [Design: policy and Figma checks](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-policy-figma.md)

## Contributing

Issues and PRs are welcome. Bug reports with a repro, docs and translations, and demo improvements all help.

```bash
git clone https://github.com/Ahnseungc/device-farm.git && cd device-farm
npm install
npm run typecheck && npm test && npm run build
npm run dev        # UI development (vite dev), config: farm.config.ts → farm.config.example.ts
npm run demo:dev   # demo UI with fixture data at http://127.0.0.1:5499
```

It is an npm workspaces monorepo. Dependencies point one way, `core ← devices ← engine ← server ← apps`, enforced by `tools/boundaries.test.ts`. The published package bundles the workspaces into `dist/` (tsup + vite build).

The demo (`apps/web/demo/`) swaps only `./api-client` and `./live-view` for fixture modules and reuses the real screens; it is not part of the package build.
`npm run demo:build && npx tsx tools/record-demo-gif.ts` regenerates `docs/assets/demo.gif` (needs ffmpeg). Pushing to `main` deploys the demo to GitHub Pages via `.github/workflows/pages.yml`.

Releases: bump `package.json` and `CHANGELOG.md`, run `npm run publish:npm` (`prepublishOnly` runs typecheck, test, and build), then push a `v<version>` tag.

## License

[MIT](https://github.com/Ahnseungc/device-farm/blob/main/LICENSE)
