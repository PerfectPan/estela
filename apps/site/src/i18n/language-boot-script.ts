import { DOCS_BOOT_TIMEOUT_MS, DOCS_PENDING_CLASS, LANG_STORAGE_KEY } from './lang-preference.ts'

/**
 * Runs in `<head>` before first paint. Sets `<html lang>` from the stored choice or
 * `navigator.language`. Chinese visitors also get `estela-docs-pending` (with a 3 s pre-hydration
 * safety timeout) so the English prerender stays hidden until the Chinese body is ready or the cap expires.
 */
export function languageBootScript(): string {
  const pending = JSON.stringify(DOCS_PENDING_CLASS)
  return `var stored=null;try{stored=localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)})}catch(e){}var language=typeof navigator!=="undefined"&&navigator.language?navigator.language:"";var lang=stored==="en"||stored==="zh-CN"?stored:language.toLowerCase().indexOf("zh")===0?"zh-CN":"en";document.documentElement.lang=lang;if(lang==="zh-CN"){document.documentElement.classList.add(${pending});if(typeof setTimeout==="function")setTimeout(function(){document.documentElement.classList.remove(${pending})},${DOCS_BOOT_TIMEOUT_MS});}`
}
