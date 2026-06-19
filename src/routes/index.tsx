import { createFileRoute } from '@tanstack/react-router'
import { Webhook } from 'lucide-react'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex items-center gap-3">
        <Webhook className="size-8 text-primary" aria-hidden="true" />
        <h1 className="text-3xl font-semibold tracking-tight">AutoForm</h1>
      </div>
      <p className="max-w-md text-muted-foreground">
        Embeddable form-to-webhook bridge. Drop a simple HTML form onto any site
        and route submissions to Slack, Airtable, email, or any webhook.
      </p>
      <p className="text-sm text-muted-foreground">
        Scaffolding in place — Phase 0 (MVP) build underway.
      </p>
    </main>
  )
}
