import { assert, click, evaluate, waitFor } from './check-site-cdp.mjs'

async function openIsolatedTrackedPage({ chrome, prefix, lang, disableCache = false, errors, badResponses }) {
  const page = await chrome.openIsolatedPage()
  try {
    await page.cdp.send('Page.enable')
    await page.cdp.send('Runtime.enable')
    await page.cdp.send('Network.enable')
    if (disableCache) {
      await page.cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    }
    page.cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') {
        errors.push(`${prefix} console.error: ${p.args.map(a => a.value ?? a.description ?? '').join(' ')}`)
      }
    })
    page.cdp.on('Runtime.exceptionThrown', p => {
      errors.push(`${prefix} uncaught: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`)
    })
    page.cdp.on('Network.responseReceived', p => {
      if (p.response.status >= 400 && !p.response.url.includes('/favicon.ico')) {
        badResponses.push(`${prefix} ${p.response.status} ${p.response.url}`)
      }
    })
    await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('estela-lang', ${JSON.stringify(lang)});`,
    })
    return page
  } catch (error) {
    await page.close()
    throw error
  }
}

/** Verifies a Chinese reader never gets stuck on `estela-docs-pending` across SPA forward, back, and landing -> docs. */
export async function checkZhSpaNavigation({ chrome, origin, base, errors, badResponses }) {
  const page = await openIsolatedTrackedPage({ chrome, prefix: 'zh-nav', lang: 'zh-CN', errors, badResponses })
  try {
    const assertZhVisible = async (expectedPath, h1, label) => {
      await waitFor(
        () =>
          evaluate(
            page.cdp,
            `location.pathname === ${JSON.stringify(expectedPath)} && !document.documentElement.classList.contains('estela-docs-pending') && document.querySelector('[data-docs] h1')?.textContent?.trim() === ${JSON.stringify(h1)}`,
          ),
        label,
        3_000,
      )
      await new Promise(resolve => setTimeout(resolve, 150))
      const pending = await evaluate(page.cdp, `document.documentElement.classList.contains('estela-docs-pending')`)
      assert(!pending, `${label}: estela-docs-pending reappeared after navigation`)
    }

    await page.cdp.send('Page.navigate', { url: `${origin}${base}docs/guide/privacy/` })
    await assertZhVisible(`${base}docs/guide/privacy/`, '隐私与脱敏', 'zh privacy load')
    // Wait past the initial 800ms safety timeout so subsequent SPA steps cannot be rescued by it.
    await new Promise(resolve => setTimeout(resolve, 900))
    const savedScrollY = await evaluate(
      page.cdp,
      `(() => { const y = Math.min(1500, document.documentElement.scrollHeight - window.innerHeight); window.scrollTo(0, y); return y; })()`,
    )
    await waitFor(
      () => evaluate(page.cdp, `Math.abs(window.scrollY - ${savedScrollY}) < 20`),
      'scroll privacy before navigation',
    )
    // Allow TanStack Router's throttled scroll-restoration listener to flush `savedScrollY` before clicking.
    await new Promise(resolve => setTimeout(resolve, 400))

    await click(page.cdp, `#nd-sidebar a[href="${base}docs/guide/concepts/"]`)
    await assertZhVisible(`${base}docs/guide/concepts/`, '概念', 'zh privacy -> concepts')

    await evaluate(page.cdp, `history.back()`)
    await assertZhVisible(`${base}docs/guide/privacy/`, '隐私与脱敏', 'zh back -> privacy')
    await waitFor(
      () => evaluate(page.cdp, `Math.abs(window.scrollY - ${savedScrollY}) < 80`),
      'zh back -> privacy scroll restore',
      2_000,
    )

    await evaluate(page.cdp, `history.forward()`)
    await assertZhVisible(`${base}docs/guide/concepts/`, '概念', 'zh forward -> concepts')

    await page.cdp.send('Page.navigate', { url: `${origin}${base}` })
    await waitFor(
      () => evaluate(page.cdp, `document.readyState === 'complete' && document.documentElement.lang === 'zh-CN'`),
      'zh landing',
    )
    await click(page.cdp, `header a[href="${base}docs/guide/"]`)
    await assertZhVisible(`${base}docs/guide/`, '用户指南', 'zh landing -> docs')
  } finally {
    await page.close()
  }
}

/** Verifies repeated isolated cold loads settle cleanly on the active locale with zero errors. */
export async function checkColdDocsLoads({ chrome, origin, base, errors, badResponses, setJsDelayMs }) {
  const runs = [
    ...Array.from({ length: 20 }, () => ({
      lang: 'zh-CN',
      path: 'docs/guide/getting-started/',
      h1: '入门',
    })),
    ...Array.from({ length: 20 }, () => ({
      lang: 'en',
      path: 'docs/guide/privacy/',
      h1: 'Privacy and redaction',
    })),
  ]
  setJsDelayMs(25)
  try {
    for (let i = 0; i < runs.length; i += 1) {
      const { lang, path: docPath, h1 } = runs[i]
      const page = await openIsolatedTrackedPage({
        chrome,
        prefix: `cold[${i}:${lang}]`,
        lang,
        disableCache: true,
        errors,
        badResponses,
      })
      try {
        await page.cdp.send('Page.navigate', { url: `${origin}${base}${docPath}` })
        await waitFor(
          () =>
            evaluate(
              page.cdp,
              `document.readyState === 'complete' && !document.documentElement.classList.contains('estela-docs-pending') && document.querySelector('[data-docs] h1')?.textContent?.trim() === ${JSON.stringify(h1)}`,
            ),
          `cold load ${i + 1}/${runs.length} (${lang} -> ${h1})`,
          5_000,
        )
        // Allow post-hydration MDX chunk resolution and layout effects to settle so recoverable errors surface.
        await new Promise(resolve => setTimeout(resolve, 300))
      } finally {
        await page.close()
      }
    }
  } finally {
    setJsDelayMs(0)
  }
}
