import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Inbox, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { Textarea } from '~/components/ui/textarea'
import { createFormFn, deleteFormFn, listFormsFn } from '~/lib/server-fns'

export const Route = createFileRoute('/dashboard/')({
  loader: () => listFormsFn(),
  component: FormsPage,
})

const DEFAULT_DEFINITION = JSON.stringify(
  {
    version: 1,
    fields: [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'message', label: 'Message', type: 'textarea' },
    ],
  },
  null,
  2,
)

function FormsPage() {
  const forms = Route.useLoaderData()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState(DEFAULT_DEFINITION)
  const [pending, setPending] = useState(false)

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    let parsed: unknown
    try {
      parsed = JSON.parse(definition)
    } catch {
      toast.error('The form definition must be valid JSON.')
      return
    }
    setPending(true)
    const res = await createFormFn({ data: { name, definition: parsed } })
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Form created.')
    setOpen(false)
    setName('')
    setDefinition(DEFAULT_DEFINITION)
    router.invalidate()
  }

  async function onDelete(formId: string, formName: string) {
    if (!window.confirm(`Delete “${formName}” and all its submissions?`)) return
    const res = await deleteFormFn({ data: { formId } })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Form deleted.')
    router.invalidate()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
          <p className="text-sm text-muted-foreground">
            Create a form, point your HTML at its endpoint, route submissions.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" aria-hidden="true" />
              New form
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={onCreate}>
              <DialogHeader>
                <DialogTitle>New form</DialogTitle>
                <DialogDescription>
                  Every form has a canonical definition that validates
                  submissions.
                </DialogDescription>
              </DialogHeader>
              <div className="my-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="form-name">Name</Label>
                  <Input
                    id="form-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contact form"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="form-definition">Definition (JSON)</Label>
                  <Textarea
                    id="form-definition"
                    className="h-56 font-mono text-xs"
                    value={definition}
                    onChange={(e) => setDefinition(e.target.value)}
                    spellCheck={false}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Creating…' : 'Create form'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {forms.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            No forms yet. Create your first one to get an endpoint.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Submissions</TableHead>
                <TableHead className="text-right">Destinations</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((form) => (
                <TableRow key={form.id}>
                  <TableCell>
                    <Link
                      to="/dashboard/forms/$formId"
                      params={{ formId: form.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {form.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {form.submissionCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {form.destinationCount}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${form.name}`}
                      onClick={() => onDelete(form.id, form.name)}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
