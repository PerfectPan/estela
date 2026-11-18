import { existsSync, globSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { assert, click, createCdp, evaluate, launchChrome, startStaticServer, waitFor } from './check-site-cdp.mjs'

const siteRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(siteRoot, 'dist/client')

function normalizeBase(value) {
  const trimmed = value.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? '/' : `/${trimmed}/`
}

const base = normalizeBase(process.env.ESTELA_SITE_BASE ?? '/estela/')
const canonicalRoot = `https://perfectpan.github.io${base}`

async function assertHeadingInViewport(cdp, id, label) {
  await waitFor(
    () =>
      evaluate(
        cdp,
        `(() => {
          const el = document.getElementById(${JSON.stringify(id)});
          if (!el) return false;
          const top = el.getBoundingClientRect().top;
          return window.scrollY > 0 && top >= 0 && top < window.innerHeight;
        })()`,
      ),
    `${label} heading #${id} inside viewport`,
    5_000,
  )
}

function listPrerenderedDocsUrls() {
  const docsHtml = globSync('docs/**/index.html', { cwd: distDir })
    .map(file => file.replaceAll('\\', '/'))
    .sort()
  assert(docsHtml.length > 0, 'no prerendered docs/**/index.html files found')
  return docsHtml.map(file => `${base}${file.slice(0, -'index.html'.length)}`)
}

async function checkColdDocsLoads({ chrome, origin, errors, badResponses, setJsDelayMs }) {
  const runs = [
    ...Array.from({ length: 20 }, () => ({ lang: 'zh-CN', h1: '入门' })),
    ...Array.from({ length: 4 }, () => ({ lang: 'en', h1: 'Getting started' })),
  ]
  setJsDelayMs(25)
  try {
    for (let i = 0; i < runs.length; i += 1) {
      const { lang, h1 } = runs[i]
      const page = await chrome.openIsolatedPage()
      try {
        await page.cdp.send('Page.enable')
        await page.cdp.send('Runtime.enable')
        await page.cdp.send('Network.enable')
        await page.cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
        page.cdp.on('Runtime.consoleAPICalled', p => {
          if (p.type === 'error') {
            errors.push(
              `cold[${i}:${lang}] console.error: ${p.args.map(a => a.value ?? a.description ?? '').join(' ')}`,
            )
          }
        })
        page.cdp.on('Runtime.exceptionThrown', p => {
          errors.push(
            `cold[${i}:${lang}] uncaught: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`,
          )
        })
        page.cdp.on('Network.responseReceived', p => {
          if (p.response.status >= 400 && !p.response.url.includes('/favicon.ico')) {
            badResponses.push(`cold[${i}:${lang}] ${p.response.status} ${p.response.url}`)
          }
        })
        await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `localStorage.setItem('estela-lang', ${JSON.stringify(lang)});`,
        })
        await page.cdp.send('Page.navigate', { url: `${origin}${base}docs/guide/getting-started/` })
        await waitFor(
          () =>
            evaluate(
              page.cdp,
              `document.querySelector('[data-docs] h1')?.textContent?.trim() === ${JSON.stringify(h1)}`,
            ),
          `cold load ${i + 1}/${runs.length} (${lang} -> ${h1})`,
          5_000,
        )
      } finally {
        await page.close()
      }
    }
  } finally {
    setJsDelayMs(0)
  }
}

async function main() {
  assert(existsSync(path.join(distDir, 'index.html')), 'dist/client/index.html missing; run build first')
  const { server, origin, requested, outOfBase, setJsDelayMs } = await startStaticServer(distDir, base)
  let chrome
  const errors = []
  const badResponses = []

  try {
    chrome = await launchChrome()
    const cdp = createCdp(chrome.ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')

    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') {
        errors.push(`console.error: ${p.args.map(a => a.value ?? a.description ?? '').join(' ')}`)
      }
    })
    cdp.on('Runtime.exceptionThrown', p => {
      errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`)
    })
    cdp.on('Network.responseReceived', p => {
      if (p.response.url.startsWith(origin) && p.response.status >= 400) {
        badResponses.push(`${p.response.status} ${p.response.url}`)
      }
    })

    await cdp.send('Page.navigate', { url: `${origin}${base}` })
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.readyState === 'complete' && Boolean(document.querySelector('[data-lang="en"] h1')?.textContent)`,
        ),
      'landing',
    )
    assert(await evaluate(cdp, `document.title.trim().length > 0`), 'landing title is empty')

    // In-place language toggle persists on reload without changing URL path.
    await click(cdp, 'button[lang="zh-CN"]')
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.documentElement.lang === 'zh-CN' && getComputedStyle(document.querySelector('[data-lang="zh-CN"]')).visibility === 'visible'`,
        ),
      'zh-CN landing',
    )
    assert(
      await evaluate(
        cdp,
        `document.querySelector('[data-lang="en"]')?.getAttribute('aria-hidden') === 'true' && getComputedStyle(document.querySelector('[data-lang="en"]')).visibility === 'hidden'`,
      ),
      'English landing tree remained visible after switching to zh-CN',
    )
    assert((await evaluate(cdp, `location.pathname`)) === base, 'language switch altered landing URL path')
    await cdp.send('Page.reload')
    await waitFor(
      () => evaluate(cdp, `document.readyState === 'complete' && document.documentElement.lang === 'zh-CN'`),
      'persisted zh-CN after reload',
    )
    await click(cdp, 'button[lang="en"]')
    await waitFor(() => evaluate(cdp, `document.documentElement.lang === 'en'`), 'switch back to en')

    // Clicking Docs goes to /docs/guide/ with User Guide marked active in the sidebar.
    await click(cdp, `header a[href="${base}docs/guide/"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/guide/`)} && Boolean(document.querySelector('[data-docs] h1')?.textContent)`,
        ),
      '/docs/guide/ page',
    )
    assert(
      await evaluate(
        cdp,
        `document.querySelector('a[href="${base}docs/guide/"]')?.getAttribute('data-active') === 'true'`,
      ),
      'User Guide item not marked active on /docs/guide/',
    )
    assert(
      (await evaluate(cdp, `document.querySelector('link[rel="canonical"]')?.getAttribute('href')`))
        === `${canonicalRoot}docs/guide/`,
      'unexpected /docs/guide/ canonical',
    )

    // Cross-page anchor navigation from getting-started to privacy#the-session-index lands on the heading.
    await click(cdp, `a[href="${base}docs/guide/getting-started/"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/guide/getting-started/`)} && Boolean(document.querySelector('[data-docs] a[href$="privacy/#the-session-index"]'))`,
        ),
      'getting-started anchor link',
    )
    await click(cdp, `[data-docs] a[href="${base}docs/guide/privacy/#the-session-index"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/guide/privacy/`)} && location.hash === '#the-session-index'`,
        ),
      'privacy#the-session-index navigation',
    )
    await assertHeadingInViewport(cdp, 'the-session-index', 'cross-page English')

    // Sidebar reference navigation and top-level architecture item.
    await click(cdp, `a[href="${base}docs/reference/public-interface/"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/reference/public-interface/`)} && Boolean(document.querySelector('[data-docs] h1')?.textContent)`,
        ),
      'public-interface docs page',
    )
    assert(
      await evaluate(cdp, `Boolean(document.querySelector('a[href="${base}docs/architecture/overview/"]'))`),
      'top-level architecture/overview link missing in sidebar',
    )

    // Direct open of every prerendered docs/**/index.html page asserts title, h1, canonical slash, and no errors.
    for (const urlPath of listPrerenderedDocsUrls()) {
      await cdp.send('Page.navigate', { url: `${origin}${urlPath}` })
      const expectedPath = urlPath === `${base}docs/` ? `${base}docs/guide/` : urlPath
      await waitFor(
        () =>
          evaluate(
            cdp,
            `document.readyState === 'complete' && location.pathname === ${JSON.stringify(expectedPath)} && Boolean(document.querySelector('[data-docs] h1')?.textContent?.trim())`,
          ),
        `direct open ${urlPath}`,
      )
      const title = await evaluate(cdp, `document.title`)
      assert(
        typeof title === 'string' && title.trim().length > 0 && title.endsWith(' · Estela'),
        `bad title at ${urlPath}: ${title}`,
      )
      const canonical = await evaluate(cdp, `document.querySelector('link[rel="canonical"]')?.getAttribute('href')`)
      assert(canonical === `https://perfectpan.github.io${expectedPath}`, `bad canonical at ${urlPath}: ${canonical}`)
    }

    // With a hash in the URL, scrolling away and switching languages (en -> zh-CN -> en) preserves scrollY.
    await cdp.send('Page.navigate', { url: `${origin}${base}docs/guide/privacy/#the-session-index` })
    await assertHeadingInViewport(cdp, 'the-session-index', 'direct English')
    const privacyScrollY = await evaluate(
      cdp,
      `(() => { const y = Math.min(2300, document.documentElement.scrollHeight - window.innerHeight); window.scrollTo(0, y); return y; })()`,
    )
    await waitFor(() => evaluate(cdp, `Math.abs(window.scrollY - ${privacyScrollY}) < 20`), 'scroll away on privacy')
    await click(cdp, 'button[lang="zh-CN"]')
    await waitFor(
      () => evaluate(cdp, `document.querySelector('[data-docs] h1')?.textContent?.trim() === '隐私与脱敏'`),
      'privacy zh-CN H1 after switch',
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    const afterZhY = await evaluate(cdp, `window.scrollY`)
    assert(
      Math.abs(afterZhY - privacyScrollY) < 40,
      `switching to zh-CN jumped scroll from ${privacyScrollY} to ${afterZhY}`,
    )
    await click(cdp, 'button[lang="en"]')
    await waitFor(
      () => evaluate(cdp, `document.querySelector('[data-docs] h1')?.textContent?.trim() === 'Privacy and redaction'`),
      'privacy en H1 after switch back',
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    const afterEnY = await evaluate(cdp, `window.scrollY`)
    assert(
      Math.abs(afterEnY - privacyScrollY) < 40,
      `switching back to en jumped scroll from ${privacyScrollY} to ${afterEnY}`,
    )

    // Reloading a hash URL after scrolling away restores the scrolled position instead of jumping to the anchor.
    await new Promise(resolve => setTimeout(resolve, 100))
    await cdp.send('Page.reload')
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.readyState === 'complete' && document.querySelector('[data-docs] h1')?.textContent?.trim() === 'Privacy and redaction'`,
        ),
      'privacy reload',
    )
    await new Promise(resolve => setTimeout(resolve, 150))
    const afterReloadY = await evaluate(cdp, `window.scrollY`)
    assert(
      Math.abs(afterReloadY - privacyScrollY) < 80,
      `reload on hash URL jumped from ${privacyScrollY} to ${afterReloadY}`,
    )

    // A shared-id hash page (export-formats/#atif) keeps scrollY across a language switch.
    await cdp.send('Page.navigate', { url: `${origin}${base}docs/reference/export-formats/#atif` })
    await assertHeadingInViewport(cdp, 'atif', 'direct English #atif')
    const atifScrollY = await evaluate(
      cdp,
      `(() => { const y = Math.min(2300, document.documentElement.scrollHeight - window.innerHeight); window.scrollTo(0, y); return y; })()`,
    )
    await waitFor(
      () => evaluate(cdp, `Math.abs(window.scrollY - ${atifScrollY}) < 20`),
      'scroll away on export-formats',
    )
    await click(cdp, 'button[lang="zh-CN"]')
    await waitFor(
      () => evaluate(cdp, `document.querySelector('[data-docs] h1')?.textContent?.trim() === '导出格式'`),
      'export-formats zh-CN H1',
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    const afterSharedSwitchY = await evaluate(cdp, `window.scrollY`)
    assert(
      Math.abs(afterSharedSwitchY - atifScrollY) < 40,
      `shared-id switch to zh-CN jumped scroll from ${atifScrollY} to ${afterSharedSwitchY}`,
    )

    // Clicking a TOC anchor, scrolling away, and switching languages does not jump back to the TOC target.
    await evaluate(cdp, `localStorage.setItem('estela-lang', 'en')`)
    await cdp.send('Page.navigate', { url: `${origin}${base}docs/guide/privacy/` })
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.readyState === 'complete' && Boolean(document.querySelector('a[href="#what-a-report-still-contains"]'))`,
        ),
      'privacy TOC',
    )
    await click(cdp, 'a[href="#what-a-report-still-contains"]')
    await waitFor(
      () => evaluate(cdp, `location.hash === '#what-a-report-still-contains' && window.scrollY > 300`),
      'TOC scroll',
    )
    await evaluate(cdp, `window.scrollTo(0, 300)`)
    await waitFor(() => evaluate(cdp, `Math.abs(window.scrollY - 300) < 20`), 'scroll to 300 after TOC')
    await click(cdp, 'button[lang="zh-CN"]')
    await waitFor(
      () => evaluate(cdp, `document.querySelector('[data-docs] h1')?.textContent?.trim() === '隐私与脱敏'`),
      'privacy zh-CN after TOC',
    )
    await click(cdp, 'button[lang="en"]')
    await waitFor(
      () => evaluate(cdp, `document.querySelector('[data-docs] h1')?.textContent?.trim() === 'Privacy and redaction'`),
      'privacy en after TOC',
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    const afterTocSwitchY = await evaluate(cdp, `window.scrollY`)
    assert(Math.abs(afterTocSwitchY - 300) < 40, `TOC language switch jumped scroll from 300 to ${afterTocSwitchY}`)

    // Translated page opened directly with estela-lang=zh-CN shows Chinese H1 and scrolls to Chinese or shared hashes.
    await evaluate(cdp, `localStorage.setItem('estela-lang', 'zh-CN')`)
    await cdp.send('Page.navigate', { url: `${origin}${base}docs/guide/concepts/` })
    await waitFor(
      () =>
        evaluate(
          cdp,
          `!document.documentElement.classList.contains('estela-docs-pending') && document.querySelector('[data-docs] h1')?.textContent?.trim() === '概念'`,
        ),
      'Chinese concepts H1',
    )
    await cdp.send('Page.navigate', { url: `${origin}${base}docs/reference/export-formats/#atif` })
    await waitFor(
      () =>
        evaluate(
          cdp,
          `!document.documentElement.classList.contains('estela-docs-pending') && document.querySelector('[data-docs] h1')?.textContent?.trim() === '导出格式'`,
        ),
      'direct Chinese export-formats H1',
    )
    await assertHeadingInViewport(cdp, 'atif', 'direct Chinese #atif')
    await cdp.send('Page.navigate', { url: `${origin}${base}docs/guide/getting-started/` })
    await waitFor(
      () =>
        evaluate(
          cdp,
          `!document.documentElement.classList.contains('estela-docs-pending') && document.querySelector('[data-docs] h1')?.textContent?.trim() === '入门'`,
        ),
      'Chinese getting-started H1',
    )
    await evaluate(
      cdp,
      `[...document.querySelectorAll('[data-docs] a')].find(a => decodeURIComponent(a.getAttribute('href') ?? '').endsWith('privacy/#会话索引'))?.click()`,
    )
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/guide/privacy/`)} && document.querySelector('[data-docs] h1')?.textContent?.trim() === '隐私与脱敏'`,
        ),
      'Chinese cross-page privacy navigation',
    )
    await assertHeadingInViewport(cdp, '会话索引', 'cross-page Chinese')
    await cdp.send('Page.navigate', { url: `${origin}${base}docs/guide/privacy/#会话索引` })
    await waitFor(
      () =>
        evaluate(
          cdp,
          `!document.documentElement.classList.contains('estela-docs-pending') && document.querySelector('[data-docs] h1')?.textContent?.trim() === '隐私与脱敏'`,
        ),
      'direct Chinese privacy page',
    )
    await assertHeadingInViewport(cdp, '会话索引', 'direct Chinese')

    // Design page waits for at least one image to load and shows the Chinese fallback notice.
    await click(cdp, `a[href="${base}docs/design/"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `(() => {
            const imgs = [...document.querySelectorAll('[data-docs] img')];
            return location.pathname === ${JSON.stringify(`${base}docs/design/`)} && imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0) && document.body.textContent.includes('此页尚无中文译本');
          })()`,
        ),
      'design page image and fallback notice',
    )

    // Both static search indexes must exist under the site base path.
    for (const lang of ['en', 'zh-CN']) {
      const status = await evaluate(
        cdp,
        `fetch(${JSON.stringify(`${base}api/search.${lang}.json`)}).then(r => r.status)`,
      )
      assert(status === 200, `search.${lang}.json returned ${status}`)
    }

    // Live demo loads cleanly without errors.
    await cdp.send('Page.navigate', { url: `${origin}${base}demo/` })
    await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('#report-trace'))`), 'demo report trace script')

    // Repeated isolated cold loads on docs never get stranded on the English prerender when zh-CN is active.
    await checkColdDocsLoads({ chrome, origin, errors, badResponses, setJsDelayMs })

    assert(outOfBase.length === 0, `requests left base path ${base}: ${outOfBase.join(', ')}`)
    assert(!requested.some(p => /\/zh(?:\/|$)/.test(p)), `unexpected /zh request: ${requested.join(', ')}`)
    assert(badResponses.length === 0, `HTTP errors: ${badResponses.join(', ')}`)
    assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`)
    console.log(`check-site passed (${requested.length} static requests under ${base})`)
  } finally {
    await chrome?.close()
    server.close()
  }
}

await main()
