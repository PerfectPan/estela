import process from 'node:process'
import { runCli } from './entry/app.ts'

export async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2))
  if (code !== 0) {
    // A failed command can leave reads and timers pending; its exit code is final.
    process.exit(code)
  }
}
