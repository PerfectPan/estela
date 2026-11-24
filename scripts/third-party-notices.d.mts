export interface ThirdPartyNoticesOptions {
  /** Web package directory; defaults to `<repo>/apps/web`. */
  webPackage?: string
  /** Adapted-source notices file; defaults to `<repo>/third-party-notices.md`. */
  sourceNotices?: string
  /** Package directory whose vite-plus runs `vp pack`; defaults to `webPackage`. */
  packPackage?: string
  /** Package name printed in the header; defaults to `@rivus/estela`. */
  packageName?: string
  /** Section heading for the packed Node bundle; defaults to `dist/cli.mjs`. */
  bundleLabel?: string
  /** Section heading for the web bundle; defaults to `dist/web/`. */
  webLabel?: string
  /** Introductory paragraphs between the header and the first section; defaults to the CLI's text. */
  intro?: readonly string[]
}

export function thirdPartyNotices(options?: ThirdPartyNoticesOptions): {
  name: string
  generateBundle(this: {
    getModuleIds(): Iterable<string>
    emitFile(file: { type: 'asset'; fileName: string; source: string }): void
  }): void
}
