import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { type } from 'arktype'
import { ArrowLeft, Copy, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
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
import { EXPORT_FORMAT_OPTIONS, exportDownloadPath } from '~/lib/export-links'
import type { DeliverySummary } from '~/lib/inbox'
import {
  MAX_RETENTION_DAYS,
  type RetentionMode,
  describeRetention,
  retentionMode,
  retentionNeedsConfirmation,
} from '~/lib/retention'
import {
  addDestinationFn,
  deleteDestinationFn,
  getFormFn,
  listInboxFn,
  renameFormFn,
  setRetentionFn,
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

  // Retention shapes what the inbox can honestly show (FR-SUB-3): on a
  // zero-retention form an empty list is the policy working, not a missing row.
  const zeroRetention = inbox?.retentionDays === 0
  const inboxRows = inbox?.submissions ?? []

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
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Inbox</CardTitle>
            <CardDescription>
              {zeroRetention
                ? 'This form doesn’t retain submissions — each one is purged as soon as delivery finishes. Rows appear only while delivery is in flight.'
                : 'Stored submissions and their delivery status.'}
            </CardDescription>
          </div>
          <ExportSubmissionsMenu
            formId={form.id}
            submissionCount={inboxRows.length}
          />
        </CardHeader>
        <CardContent>
          {inboxRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {zeroRetention
                ? 'Nothing retained. Delivered submissions live in your destinations, not here.'
                : 'No submissions yet — there’s nothing to export.'}
            </p>
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
                {inboxRows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs">
                      {s.purgedAt ? (
                        <span className="font-sans italic text-muted-foreground">
                          Content purged {new Date(s.purgedAt).toLocaleString()}
                        </span>
                      ) : (
                        JSON.stringify(s.normalizedPayload)
                      )}
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

      <RetentionCard
        formId={form.id}
        retentionDays={form.retentionDays}
        onSaved={() => router.invalidate()}
      />

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

/**
 * Download this form's submissions as CSV or JSON (FR-SUB-4).
 *
 * The items are plain anchors, not click handlers: the endpoint answers with
 * `Content-Disposition: attachment`, so letting the browser navigate is what
 * produces the file — and a link is focusable, activates on Enter, and offers
 * the usual "save link as" affordances for free (NFR-A11Y-2).
 *
 * With no submissions there is nothing to download, so the trigger is disabled
 * and says why; the empty inbox below it repeats that in words.
 */
function ExportSubmissionsMenu({
  formId,
  submissionCount,
}: {
  formId: string
  submissionCount: number
}) {
  const empty = submissionCount === 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={empty}
          aria-label="Export submissions"
          title={empty ? 'No submissions to export yet.' : 'Export submissions'}
        >
          <Download className="size-4" aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {EXPORT_FORMAT_OPTIONS.map(({ format, label }) => (
          <DropdownMenuItem key={format} asChild>
            <a href={exportDownloadPath(formId, format)}>{label}</a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Retention settings (FR-SUB-3, D-011). The three states live in one nullable
 * integer, so the picker maps modes onto it rather than exposing the encoding.
 *
 * Anything that shortens the window is confirmed first: retention applies to the
 * data, not to when the policy was set, so a reduction deletes stored
 * submissions retroactively on the next purge pass.
 */
function RetentionCard({
  formId,
  retentionDays,
  onSaved,
}: {
  formId: string
  retentionDays: number | null
  onSaved: () => void
}) {
  const [mode, setMode] = useState<RetentionMode>(retentionMode(retentionDays))
  const [days, setDays] = useState(
    retentionDays && retentionDays > 0 ? String(retentionDays) : '90',
  )
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)

  function nextValue(): number | null | undefined {
    if (mode === 'indefinite') return null
    if (mode === 'zero') return 0
    const parsed = Number(days)
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_RETENTION_DAYS
    ) {
      toast.error(
        `Enter a whole number of days from 1 to ${MAX_RETENTION_DAYS}.`,
      )
      return undefined
    }
    return parsed
  }

  async function save(value: number | null) {
    setPending(true)
    const res = await setRetentionFn({ data: { formId, retentionDays: value } })
    setPending(false)
    setConfirming(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Retention policy saved.')
    onSaved()
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next = nextValue()
    if (next === undefined) return
    if (retentionNeedsConfirmation(retentionDays, next)) {
      setConfirming(next)
      return
    }
    void save(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention</CardTitle>
        <CardDescription>
          How long AutoForm keeps this form’s submissions. Anything already
          delivered to a destination is unaffected — delete it there.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="retention-mode">Policy</Label>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as RetentionMode)}
              >
                <SelectTrigger id="retention-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="indefinite">Keep indefinitely</SelectItem>
                  <SelectItem value="days">
                    Keep for a set number of days
                  </SelectItem>
                  <SelectItem value="zero">
                    Zero-retention (don’t store)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === 'days' && (
              <div className="flex flex-col gap-2 sm:w-40">
                <Label htmlFor="retention-days">Days</Label>
                <Input
                  id="retention-days"
                  type="number"
                  min={1}
                  max={MAX_RETENTION_DAYS}
                  step={1}
                  required
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>

          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Current: </span>
              {describeRetention(retentionDays)}
            </p>
            {mode === 'zero' ? (
              <p>
                Zero-retention still accepts and delivers submissions, but
                purges the stored copy as soon as every delivery finishes — so
                the inbox, export, and manual replay are unavailable for this
                form.
              </p>
            ) : (
              <p>
                Shortening the window applies to submissions you already have,
                not just to new ones.
              </p>
            )}
          </div>
        </form>
      </CardContent>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === 0
                ? 'Turn on zero-retention?'
                : 'Shorten retention?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === 0
                ? 'Stored submissions for this form will be purged once delivery finishes, and the inbox, export, and manual replay will stop working for it. Submissions already delivered to your destinations are not affected.'
                : `Submissions older than ${confirming} day${confirming === 1 ? '' : 's'} will be deleted from this form’s inbox. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (confirming !== null) void save(confirming)
              }}
            >
              {pending ? 'Saving…' : 'Save policy'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
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
