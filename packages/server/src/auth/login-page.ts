/** `GET /login` 화면. React 앱 밖에서 열려야 하므로 빌드 없는 정적 HTML이다. */
export const loginTitle = "디바이스팜 로그인";
export const loginGuide = "팀 비밀번호를 입력하세요. 사내망에서만 열립니다.";

export const loginPageHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${loginTitle}</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --text: #1d1d1b; --muted: #6b6a66; --line: #dddbd5; --accent: #c8961e; --error: #c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --card: #22211f; --text: #f1efe9; --muted: #a3a19b; --line: #3a3935; --error: #ff7b6b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", sans-serif; padding: 16px; }
  form { width: 100%; max-width: 360px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px 24px; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  p { margin: 0 0 20px; color: var(--muted); font-size: 14px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { margin-top: 12px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  #error { min-height: 1.5em; margin: 10px 0 0; color: var(--error); font-size: 14px; }
</style>
</head>
<body>
<form id="login" method="post" action="/api/login">
  <h1>${loginTitle}</h1>
  <p>${loginGuide}</p>
  <label for="password" hidden>비밀번호</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">로그인</button>
  <div id="error" role="alert"></div>
</form>
<script>
  const form = document.getElementById("login");
  const error = document.getElementById("error");
  const button = form.querySelector("button");
  function nextPath() {
    const next = new URLSearchParams(location.search).get("next") || "/";
    return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\\\") ? next : "/";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    button.disabled = true;
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.password.value }),
      });
      if (response.ok) { location.replace(nextPath()); return; }
      const body = await response.json().catch(() => null);
      error.textContent = (body && body.error) || "로그인하지 못했습니다. (" + response.status + ")";
    } catch {
      error.textContent = "서버에 닿지 못했습니다.";
    } finally {
      button.disabled = false;
      form.password.select();
    }
  });
</script>
</body>
</html>
`;
