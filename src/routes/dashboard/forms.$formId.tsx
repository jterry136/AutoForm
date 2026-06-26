import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { type } from 'arktype'
import { ArrowLeft, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { generateEmbedHtml } from '~/lib/embed'
import type { DeliverySummary } from '~/lib/inbox'
import {
  addDestinationFn,
  deleteDestinationFn,
  getFormFn,
  listInboxFn,
  renameFormFn,
} from '~/lib/server-fns'
import { formDefinitionSchema } from '~/lib/validation'

export const Route = createFileRoute('/dashboard/forms/$formId')({
  loader: ({ params }) =>
    Promise.all([
      getFormFn({ data: { formId: params.formId } }),
      listInboxFn({ data: { formId: params.formId } }),
    ]),
  component: FormDetail,
})

const DELIVERY_BADGE: Record<
  DeliverySummary,
  {
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    label: string
  }
> = {
  delivered: { variant: 'default', label: 'Delivered' },
  pending: { variant: 'secondary', label: 'Pending' },
  failed: { variant: 'destructive', label: 'Failed' },
  partial: { variant: 'outline', label: 'Partial' },
  none: { variant: 'outline', label: 'No destinations' },
}

function FormDetail() {
  const [form, inbox] = Route.useLoaderData()
  const router = useRouter()
  const [origin, setOrigin] = useState('')

  useEffect(() => setOrigin(window.location.origin), [])

  if (!form) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">Form not found.</p>
        <Link to="/dashboard" className="underline">
          Back to forms
        </Link>
      </div>
    )
  }

  const endpoint = `${origin}/f/${form.publicId}`

  const parsedDefinition = formDefinitionSchema(form.definition)
  const embedHtml =
    parsedDefinition instanceof type.errors
      ? null
      : generateEmbedHtml(endpoint, parsedDefinition, {
          honeypotField: form.honeypotField,
          redirectUrl: form.redirectUrl,
        })

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint)
    toast.success('Endpoint copied.')
  }

  async function copyEmbed() {
    if (!embedHtml) return
    await navigator.clipboard.writeText(embedHtml)
    toast.success('Embed code copied.')
  }

  async function onDeleteDestination(destinationId: string) {
    const res = await deleteDestinationFn({ data: { destinationId } })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Destination removed.')
    router.invalidate()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/dashboard"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Forms
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{form.name}</h1>
          <RenameFormDialog
            formId={form.id}
            currentName={form.name}
            onRenamed={() => router.invalidate()}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Endpoint</CardTitle>
          <CardDescription>
            Point your HTML form’s <code>action</code> here (method POST).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input readOnly value={endpoint} className="font-mono text-sm" />
            <Button
              variant="outline"
              size="icon"
              onClick={copyEndpoint}
              aria-label="Copy endpoint"
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Public ID: <span className="font-mono">{form.publicId}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Embed code</CardTitle>
            <CardDescription>
              Paste this HTML on any site — no JavaScript required.
            </CardDescription>
          </div>
          {embedHtml && (
            <Button variant="outline" size="sm" onClick={copyEmbed}>
              <Copy className="size-4" aria-hidden="true" />
              Copy
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {embedHtml ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
              {embedHtml}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              The form definition is invalid, so embed code can’t be generated.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Destinations</CardTitle>
            <CardDescription>
              Where accepted submissions are delivered.
            </CardDescription>
          </div>
          <AddDestinationDialog
            formId={form.id}
            onAdded={() => router.invalidate()}
          />
        </CardHeader>
        <CardContent>
          {form.destinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No destinations yet — submissions are stored but not delivered.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {form.destinations.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-2">
                        {d.type}
                      </Badge>
                      {JSON.stringify(d.config)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${d.name}`}
                    onClick={() => onDeleteDestination(d.id)}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>
            Stored submissions and their delivery status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!inbox || inbox.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Delivery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inbox.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs">
                      {JSON.stringify(s.normalizedPayload)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={DELIVERY_BADGE[s.deliveryStatus].variant}>
                        {DELIVERY_BADGE[s.deliveryStatus].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Definition</CardTitle>
          <CardDescription>
            The canonical schema submissions are validated against.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(form.definition, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

function RenameFormDialog({
  formId,
  currentName,
  onRenamed,
}: {
  formId: string
  currentName: string
  onRenamed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(currentName)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    const res = await renameFormFn({ data: { formId, name } })
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Form renamed.')
    setOpen(false)
    onRenamed()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Rename form">
          <Pencil className="size-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Rename form</DialogTitle>
            <DialogDescription>
              Only the display name changes.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-2">
            <Label htmlFor="rename">Name</Label>
            <Input
              id="rename"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddDestinationDialog({
  formId,
  onAdded,
}: {
  formId: string
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('webhook')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [to, setTo] = useState('')
  const [from, setFrom] = useState('')
  const [subject, setSubject] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    let config: Record<string, unknown>
    let credential: string | null = null
    if (type === 'webhook') {
      config = { url }
      credential = secret.trim() ? secret.trim() : null
    } else {
      config = {
        to,
        ...(from.trim() ? { from: from.trim() } : {}),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
      }
    }
    setPending(true)
    const res = await addDestinationFn({
      data: { formId, type, name, config, secret: credential },
    })
    setPending(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Destination added.')
    setOpen(false)
    setName('')
    setUrl('')
    setSecret('')
    setTo('')
    setFrom('')
    setSubject('')
    onAdded()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" aria-hidden="true" />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add destination</DialogTitle>
            <DialogDescription>
              Deliver each accepted submission to this destination.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="dest-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="dest-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dest-name">Name</Label>
              <Input
                id="dest-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My destination"
              />
            </div>

            {type === 'webhook' ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dest-url">Webhook URL</Label>
                  <Input
                    id="dest-url"
                    type="url"
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/hook"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dest-secret">Bearer token (optional)</Label>
                  <Input
                    id="dest-secret"
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dest-to">To (comma-separated)</Label>
                  <Input
                    id="dest-to"
                    required
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dest-subject">Subject (optional)</Label>
                  <Input
                    id="dest-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add destination'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
