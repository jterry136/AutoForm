import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { LogOut, Webhook } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { signOut } from '~/lib/auth-client'
import { getSessionUserFn } from '~/lib/server-fns'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const user = await getSessionUserFn()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 font-semibold"
          >
            <Webhook className="size-5 text-primary" aria-hidden="true" />
            AutoForm
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
