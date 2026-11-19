import { createFileRoute } from '@tanstack/react-router'
import { Landing } from '@/landing/landing.tsx'
import { pageHead } from '@/landing/page-head.ts'

export const Route = createFileRoute('/')({
  head: () => pageHead(),
  component: Landing,
})
