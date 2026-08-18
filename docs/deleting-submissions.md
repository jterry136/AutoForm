# Deleting submission data

AutoForm stores every accepted submission so nothing is lost if a destination is down.
That also means you are holding other people's data, and someone may ask you to delete
theirs. This page covers how to do that.

Everything here is scoped to forms you own: the dashboard only ever deletes data belonging
to your own account, and a request for someone else's form is answered as "not found".

## Delete a single submission

1. Open the form in the dashboard (**Forms → your form**).
2. Find the submission in the **Inbox** table — the **Data** column shows the normalized
   payload, so you can match on the email address or name in the request.
3. Click the trash icon on that row and confirm.

## Delete every submission for a form

The **Delete submission data** card below the inbox removes *all* stored submissions for
that form in one action, after a confirmation step.

The form itself is not deleted: its definition, destinations, public ID and endpoint all
stay exactly as they were, so any embedded copy of the form keeps working and new
submissions keep arriving. Only the stored data goes.

To remove the form as well, delete the form from the forms list — that also removes its
submissions.

## What is actually removed

Deleting a submission — individually, by purging a form's inbox, or by deleting the form —
permanently removes:

- the **raw request body** as received,
- the **normalized payload** shown in the inbox, and
- the **delivery history** for that submission: every `delivery_attempt` row, including
  pending and dead-lettered ones, is removed with it (the database cascades on delete).

Deletion is immediate and cannot be undone. There is no trash or restore.

## What is *not* removed

**Anything already delivered stays where it was delivered.** AutoForm cannot recall a
webhook POST or an email it already sent. If a submission was delivered to Slack, an
Airtable base, a mailbox, or your own endpoint, you must delete it there too — deleting it
in AutoForm only clears AutoForm's copy.

A submission with a **pending** delivery is a special case worth knowing: deleting it also
deletes its queued attempts, so it will never be delivered. That is usually what you want
for a deletion request, but it does mean the destination never sees that submission.

## Answering a deletion request

A workable sequence for a data-subject deletion request:

1. Find the person's submissions in the form's inbox (search the **Data** column for their
   email address or name — check every form they may have used).
2. Delete each matching submission, or purge the whole inbox if that is appropriate.
3. Delete the same data from every destination the submissions were delivered to — your
   Slack channel, mailbox, Airtable base, or downstream system. AutoForm cannot do this
   for you.
4. Confirm back to the requester once both sides are done.

Holding less data makes this easier: only ask for fields you actually need in the form
definition, and purge inboxes you no longer read.

> **Automatic deletion.** Each form also has a **retention policy** (see the *Retention*
> card on the form page): keep submissions indefinitely, keep them for a set number of days,
> or use zero-retention, which purges each submission as soon as its delivery finishes. New
> forms keep submissions for 90 days by default.
>
> Retention and the manual deletion on this page remove data in two different ways, on
> purpose. Retention **redacts to a tombstone**: the content is cleared but the submission
> row and its delivery history survive, so your counts and failure records stay accurate
> ("12 received, 3 dead-lettered") while holding no personal data. Such a submission shows
> in the inbox as *content purged*, and exports label it `content_status: purged`.
> The actions on this page **delete the row outright** — nothing is left behind, which is
> what a deletion request usually calls for.
