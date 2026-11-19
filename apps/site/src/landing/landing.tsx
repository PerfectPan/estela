import { LandingPage } from './landing-page.tsx'

export function Landing() {
  return (
    // Both language trees share one grid cell so language switching updates in place without navigation.
    <div data-landing="" className="grid grid-cols-1">
      <LandingPage locale="en" />
      <LandingPage locale="zh-CN" />
    </div>
  )
}
