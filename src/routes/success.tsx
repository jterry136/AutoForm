import { createFileRoute } from '@tanstack/react-router'
import { CircleCheckBig } from 'lucide-react'

/**
 * Default hosted success page (FR-EMB-2) — where the no-JS redirect lands when a
 * form sets no `_redirect` and has no configured redirect URL.
 */
export const Route = createFileRoute('/success')({
  component: SuccessPage,
})

function SuccessPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <CircleCheckBig className="size-12 text-primary" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">
        Submission received
      </h1>
      <p className="max-w-md text-muted-foreground">
        Thanks — your form was submitted successfully. You can close this page.
      </p>
    </main>
  )
}
