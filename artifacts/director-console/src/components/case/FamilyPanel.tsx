import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCaseContact,
  useReissueContactLink,
  useSendContactLink,
  useRevokeContact,
  useUpdateContact,
  getGetCaseQueryKey,
  type FamilyContact,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

/**
 * The family's people, and their links.
 *
 * The one-time link is the whole product's front door, so this panel is
 * built around getting it into a text message with as little ceremony as
 * possible: add a name, copy the link, paste it into your phone. The link is
 * shown once and cannot be retrieved afterwards — reissuing takes one click,
 * so nothing is lost, and a link that could be read back out of the console
 * later is one a departing employee could walk away with.
 */

function LinkOnce({ link, phone }: { link: string; phone?: string | null }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
      <p className="mb-2 text-sm font-medium text-[var(--accent-deep)]">
        Send this to them now — it won't be shown again.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={link} className="bg-white font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast({
                title: "Couldn't copy that",
                description: "Select the link and copy it by hand.",
                variant: "destructive",
              });
            }
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {/*
        The last resort, and on a phone the fastest route: hand it to the
        director's own messaging app pre-filled. Costs nothing and works on a
        deployment with no SMS credentials at all.
      */}
      {phone && (
        <a
          href={`sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(link)}`}
          className="mt-2 inline-block text-sm text-[var(--accent-deep)] underline"
        >
          Open in your messages app
        </a>
      )}
    </div>
  );
}

type Props = { caseId: number; contacts: FamilyContact[] };

export function FamilyPanel({ caseId, contacts }: Props) {
  const queryClient = useQueryClient();
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [lastPhone, setLastPhone] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"next_of_kin" | "contributor">("next_of_kin");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });

  const add = useCreateCaseContact({
    mutation: {
      onSuccess: (created) => {
        setFreshLink(created.link);
        setLastPhone(created.phone);
        setName("");
        setRelationship("");
        setPhone("");
        setEmail("");
        setRole("contributor");
        refresh();
      },
    },
  });

  // A link handed back by any row lands in the one box at the top of the
  // panel, so there is only ever one "send this now" on screen.
  const showLink = (link: string, phone: string | null) => {
    setFreshLink(link);
    setLastPhone(phone);
  };

  return (
    <div className="space-y-6">
      {freshLink && <LinkOnce link={freshLink} phone={lastPhone} />}

      {contacts.length > 0 && (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              contacts={contacts}
              onLink={showLink}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      <form
        className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate({
            caseId,
            data: {
              name: name.trim(),
              relationship: relationship.trim() || null,
              phone: phone.trim() || null,
              email: email.trim() || null,
              role,
              canInvite: role === "next_of_kin",
            },
          });
        }}
      >
        <p className="font-medium">Add someone from the family</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="relationship">Relationship</Label>
            <Input
              id="relationship"
              placeholder="Daughter"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Mobile</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className="text-sm leading-snug text-muted-foreground">
              Needed for the aftercare check-ins later.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select
            value={role}
            onValueChange={(value) =>
              setRole(value as "next_of_kin" | "contributor")
            }
          >
            <SelectTrigger aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next_of_kin">
                Next of kin — the timeline is theirs
              </SelectItem>
              <SelectItem value="contributor">
                Contributor — can add photographs
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserPlus className="size-4" />
          )}
          Add and make a link
        </Button>
      </form>
    </div>
  );
}

type Role = "next_of_kin" | "contributor";

/**
 * One person on the case, with everything that can be done to them.
 *
 * Each row owns its own mutations. They used to be shared across the panel,
 * so pressing "Text it" on the daughter put a spinner on every row that had
 * a phone number — a director with five relatives on screen could not tell
 * which one was actually being sent.
 *
 * Every action that mints a link also kills the old one, because a contact
 * holds exactly one digest. That is the right behaviour for "my sister
 * forwarded it to someone she shouldn't have", and a nasty surprise for a
 * director who only meant to re-send the link the family already has. So
 * anything that would stop a working link asks first, and says so plainly.
 */
function ContactRow({
  contact,
  contacts,
  onLink,
  onChanged,
}: {
  contact: FamilyContact;
  contacts: FamilyContact[];
  onLink: (link: string, phone: string | null) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);

  const revoked = contact.revokedAt !== null;
  const opened = contact.firstSeenAt !== null;
  // Somebody the family added from their own link rather than somebody keyed
  // in here -- the question "who is this, and who let them in?" answered on
  // the row itself.
  const addedBy =
    contact.invitedByContactId === null
      ? null
      : (contacts.find((other) => other.id === contact.invitedByContactId)
          ?.name ?? "the family");

  const reissue = useReissueContactLink({
    mutation: {
      onSuccess: (updated) => {
        onLink(updated.link, updated.phone);
        onChanged();
      },
    },
  });

  const revoke = useRevokeContact({ mutation: { onSuccess: onChanged } });

  const sendLink = useSendContactLink({
    mutation: {
      onSuccess: (result) => {
        onLink(result.link, result.phone);
        onChanged();
        toast(
          result.sent
            ? { title: "Text sent" }
            : {
                // Not an error toast: they have the link on screen and can
                // send it themselves, which is a working outcome.
                title: "Couldn't text it from here",
                description: `${result.smsError ?? "Text messaging isn't set up."} The link is below — send it however suits.`,
              },
        );
      },
    },
  });

  if (editing) {
    return (
      <li className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-[var(--elevation-1)]">
        <ContactEditForm
          contact={contact}
          onDone={() => setEditing(false)}
          onSaved={onChanged}
        />
      </li>
    );
  }

  const busy = reissue.isPending || sendLink.isPending || revoke.isPending;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3.5 shadow-[var(--elevation-1)]">
      <span className="min-w-0 flex-1">
        <span className="block font-medium truncate">
          {contact.name}
          {contact.relationship ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {contact.relationship}
            </span>
          ) : null}
        </span>
        <span className="block text-sm text-muted-foreground truncate">
          {contact.role === "next_of_kin" ? "Next of kin" : "Contributor"}
          {addedBy ? ` · added by ${addedBy}` : ""}
          {contact.canInvite ? " · can add family" : ""}
          {contact.phone ? ` · ${contact.phone}` : ""}
          {contact.email ? ` · ${contact.email}` : ""}
          {/* Whether the text ever landed — otherwise invisible
              until the family fails to do anything. */}
          {revoked
            ? " · link revoked"
            : opened
              ? " · link opened"
              : " · not opened yet"}
        </span>
      </span>

      <span className="flex shrink-0 flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Edit ${contact.name}`}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" />
          Edit
        </Button>

        {contact.phone && (
          <NewLinkButton
            label="Text it"
            confirmLabel="Text a new link"
            icon={MessageSquare}
            pending={sendLink.isPending}
            disabled={busy}
            name={contact.name}
            opened={opened}
            replacesWorkingLink={!revoked}
            onConfirm={() => sendLink.mutate({ contactId: contact.id })}
          />
        )}

        <NewLinkButton
          label={revoked ? "New link" : "Copy a new one"}
          confirmLabel="Make a new link"
          icon={Link2}
          pending={reissue.isPending}
          disabled={busy}
          name={contact.name}
          opened={opened}
          replacesWorkingLink={!revoked}
          onConfirm={() => reissue.mutate({ contactId: contact.id })}
        />

        {!revoked && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={busy}
              >
                {revoke.isPending && <Loader2 className="size-4 animate-spin" />}
                Revoke
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Take away {contact.name}'s access?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Their link stops working straight away and they can no
                  longer open this family's page. Anything they have already
                  added stays on the case with their name on it, and you can
                  give them a new link later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep their access</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => revoke.mutate({ contactId: contact.id })}
                >
                  Revoke the link
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </span>
    </li>
  );
}

/**
 * A button that mints a new link, with the warning in front of it.
 *
 * When there is no working link to lose — the old one was revoked — it acts
 * straight away. A dialog that appears every time is a dialog people learn to
 * click through, and then it protects nobody on the day it matters.
 */
function NewLinkButton({
  label,
  confirmLabel,
  icon: Icon,
  pending,
  disabled,
  name,
  opened,
  replacesWorkingLink,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  icon: LucideIcon;
  pending: boolean;
  disabled: boolean;
  name: string;
  opened: boolean;
  replacesWorkingLink: boolean;
  onConfirm: () => void;
}) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={replacesWorkingLink ? undefined : onConfirm}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Icon className="size-4" />
      )}
      {label}
    </Button>
  );

  if (!replacesWorkingLink) return button;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace {name}'s link?</AlertDialogTitle>
          <AlertDialogDescription>
            {opened
              ? `The link ${name} is using now will stop working the moment you do this. Only the new one will get them back in.`
              : `The link you gave ${name} before will stop working the moment you do this, even though they have not opened it yet. Only the new one will get them in.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep the old link</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Correcting a person in place: a misspelt name, a new mobile number, the
 * nephew who turns out to be the next of kin. Editing never touches their
 * link — the family carries on with the one they have.
 */
function ContactEditForm({
  contact,
  onDone,
  onSaved,
}: {
  contact: FamilyContact;
  onDone: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(contact.name);
  const [relationship, setRelationship] = useState(contact.relationship ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [role, setRole] = useState<Role>(contact.role as Role);

  const save = useUpdateContact({
    mutation: {
      onSuccess: () => {
        onSaved();
        onDone();
      },
    },
  });

  // Several rows can be open at once, so the ids carry the contact's.
  const id = (field: string) => `contact-${contact.id}-${field}`;

  return (
    <form
      className="space-y-4"
      aria-label={`Edit ${contact.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          contactId: contact.id,
          data: {
            name: name.trim(),
            relationship: relationship.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            role,
          },
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={id("name")}>Name</Label>
          <Input
            id={id("name")}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("relationship")}>Relationship</Label>
          <Input
            id={id("relationship")}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("phone")}>Mobile</Label>
          <Input
            id={id("phone")}
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("email")}>Email</Label>
          <Input
            id={id("email")}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Role</Label>
        <Select value={role} onValueChange={(value) => setRole(value as Role)}>
          <SelectTrigger aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="next_of_kin">
              Next of kin — the timeline is theirs
            </SelectItem>
            <SelectItem value="contributor">
              Contributor — can add photographs
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm leading-snug text-muted-foreground">
        Their link keeps working. Nothing is sent to them.
      </p>

      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !name.trim()}>
          {save.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
