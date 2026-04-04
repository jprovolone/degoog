import { authHeaders } from "../utils/request";

interface ProxyTestResult {
  enabled: boolean;
  directIp: string | null;
  proxyIp: string | null;
  match: boolean | null;
}

function renderResult(el: HTMLElement, data: ProxyTestResult): void {
  if (!data.enabled) {
    el.className = "proxy-test-result proxy-test-result--warn";
    el.textContent = "Proxy is not enabled. Enable it and save before testing.";
    return;
  }

  if (!data.directIp && !data.proxyIp) {
    el.className = "proxy-test-result proxy-test-result--error";
    el.textContent =
      "Could not reach IP check service. Check your network connection.";
    return;
  }

  if (!data.proxyIp) {
    el.className = "proxy-test-result proxy-test-result--error";
    el.innerHTML =
      `<strong>Proxy unreachable.</strong> Direct IP: ${data.directIp}` +
      `<br>The proxy server could not be contacted. Check your proxy URL and that the proxy is running.`;
    return;
  }

  if (data.match) {
    el.className = "proxy-test-result proxy-test-result--warn";
    el.innerHTML =
      `<strong>IPs match — proxy may not be working.</strong>` +
      `<br>Direct: ${data.directIp} &middot; Proxy: ${data.proxyIp}` +
      `<br>Both routes returned the same IP. The proxy might not be changing your exit IP.`;
    return;
  }

  el.className = "proxy-test-result proxy-test-result--ok";
  el.innerHTML =
    `<strong>Proxy is working.</strong>` +
    `<br>Direct: ${data.directIp} &middot; Proxy: ${data.proxyIp}`;
}

export function initProxyTest(getToken: () => string | null): void {
  const btn = document.getElementById(
    "settings-proxy-test",
  ) as HTMLButtonElement | null;
  const resultEl = document.getElementById("settings-proxy-test-result");
  if (!btn || !resultEl) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Testing\u2026";
    resultEl.hidden = true;

    try {
      const res = await fetch("/api/settings/proxy-test", {
        headers: authHeaders(getToken),
      });
      if (!res.ok) {
        resultEl.className = "proxy-test-result proxy-test-result--error";
        resultEl.textContent = `Server returned ${res.status}. Make sure you are authenticated.`;
        resultEl.hidden = false;
        return;
      }
      const data = (await res.json()) as ProxyTestResult;
      renderResult(resultEl, data);
      resultEl.hidden = false;
    } catch {
      resultEl.className = "proxy-test-result proxy-test-result--error";
      resultEl.textContent = "Request failed. Check your connection.";
      resultEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Test proxy connection";
    }
  });
}
