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
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Link2, Loader2, MessageSquare, Pencil, UserPlus } from "lucide-react";
import { Confirm } from "@/components/page";

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

function LinkOnce({
  link,
  name,
  phone,
}: {
  link: string;
  name: string;
  phone?: string | null;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
      <p className="mb-2 text-sm font-medium text-[var(--accent-deep)]">
        {name}&rsquo;s link. Send it to them now — it won&rsquo;t be shown again.
      </p>
      <div className="flex gap-2">
        <Input
          readOnly
          aria-label={`${name}'s link`}
          value={link}
          onFocus={(event) => event.target.select()}
          className="bg-card font-mono text-xs"
        />
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fresh, setFresh] = useState<{
    link: string;
    name: string;
    phone: string | null;
  } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

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
        setFresh({ link: created.link, name: created.name, phone: created.phone });
        setName("");
        setRelationship("");
        setPhone("");
        setEmail("");
        setRole("contributor");
        refresh();
      },
    },
  });

  const reissue = useReissueContactLink({
    mutation: {
      onSuccess: (updated) => {
        setFresh({ link: updated.link, name: updated.name, phone: updated.phone });
        refresh();
      },
    },
  });

  const revoke = useRevokeContact({ mutation: { onSuccess: refresh } });
  const update = useUpdateContact({
    mutation: {
      onSuccess: () => {
        setEditing(null);
        refresh();
      },
    },
  });

  const sendLink = useSendContactLink({
    mutation: {
      onSuccess: (result) => {
        setFresh({ link: result.link, name: result.name, phone: result.phone });
        refresh();
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

  return (
    <div className="space-y-6">
      {fresh && <LinkOnce link={fresh.link} name={fresh.name} phone={fresh.phone} />}

      {contacts.length > 0 && (
        <ul className="space-y-2">
          {contacts.map((contact) => {
            const revoked = contact.revokedAt !== null;
            const opened = contact.firstSeenAt !== null;
            // Somebody the family added from their own link rather than
            // somebody keyed in here -- the question "who is this, and who
            // let them in?" answered on the row itself.
            const addedBy =
              contact.invitedByContactId === null
                ? null
                : (contacts.find((other) => other.id === contact.invitedByContactId)
                    ?.name ?? "the family");

            if (editing === contact.id) {
              return (
                <li
                  key={contact.id}
                  className="rounded-xl border border-[var(--accent)] bg-card p-4 shadow-[var(--elevation-1)]"
                >
                  <ContactEditor
                    contact={contact}
                    pending={update.isPending}
                    onCancel={() => setEditing(null)}
                    onSave={(data) => update.mutate({ contactId: contact.id, data })}
                  />
                </li>
              );
            }

            const who = contact.name;
            const textingThis =
              sendLink.isPending && sendLink.variables?.contactId === contact.id;

            return (
              <li
                key={contact.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3.5 shadow-[var(--elevation-1)]"
              >
                {/* A floor under the name, so on a phone the buttons wrap
                    beneath it instead of squeezing it to a single letter. */}
                <span className="min-w-[12rem] flex-1">
                  <span className="block font-medium truncate">
                    {contact.name}
                    {contact.relationship ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {contact.relationship}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {contact.role === "next_of_kin" ? "Next of kin" : "Contributor"}
                    {addedBy ? ` · added by ${addedBy}` : ""}
                    {contact.canInvite ? " · can add family" : ""}
                    {contact.phone ? (
                      <>
                        {" · "}
                        <a
                          href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                          className="tabular text-[var(--accent-deep)] no-underline hover:underline"
                        >
                          {contact.phone}
                        </a>
                      </>
                    ) : (
                      ""
                    )}
                    {contact.email ? ` · ${contact.email}` : ""}
                    {/* Whether the text ever landed — otherwise invisible
                        until the family fails to do anything. */}
                    {revoked
                      ? " · link stopped"
                      : opened
                        ? " · link opened"
                        : " · not opened yet"}
                  </span>
                </span>

                <span className="flex flex-wrap gap-1">
                  {contact.phone && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={textingThis}
                      onClick={() => sendLink.mutate({ contactId: contact.id })}
                    >
                      {textingThis ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <MessageSquare className="size-4" />
                      )}
                      {revoked ? "Text a new link" : "Text it"}
                    </Button>
                  )}
                  {/*
                    "Copy a new one" read as "copy the link", and pressing it
                    quietly stopped the one the family already had. A new link
                    for somebody who has one now says what it costs first.
                  */}
                  {revoked ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => reissue.mutate({ contactId: contact.id })}
                    >
                      <Link2 className="size-4" />
                      New link
                    </Button>
                  ) : (
                    <Confirm
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Link2 className="size-4" />
                          New link
                        </Button>
                      }
                      title={`Make a new link for ${who}?`}
                      description="The link they have now stops working the moment you do. Use this when they have lost it, or it reached somebody it should not have."
                      confirmLabel="Make a new link"
                      cancelLabel="Keep the old one"
                      onConfirm={() => reissue.mutate({ contactId: contact.id })}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Change ${who}'s details`}
                    onClick={() => setEditing(contact.id)}
                  >
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                  {!revoked && (
                    <Confirm
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                        >
                          Stop their link
                        </Button>
                      }
                      title={`Stop ${who}'s link?`}
                      description="They can no longer open the family's page. Everything they added stays on the case, and you can send them a new link at any time."
                      confirmLabel="Stop the link"
                      cancelLabel="Leave it working"
                      onConfirm={() => revoke.mutate({ contactId: contact.id })}
                    />
                  )}
                </span>
              </li>
            );
          })}
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
        <p className="font-medium">
          {contacts.length === 0
            ? "Start with the next of kin"
            : "Add someone from the family"}
        </p>
        {contacts.length === 0 && (
          <p className="-mt-2 text-sm leading-snug text-muted-foreground">
            They get a private link to the arrangements. Add a mobile number
            and you can text it to them from here.
          </p>
        )}

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
          <Label htmlFor="newContactRole">Role</Label>
          <Select
            value={role}
            onValueChange={(value) =>
              setRole(value as "next_of_kin" | "contributor")
            }
          >
            <SelectTrigger id="newContactRole">
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

/**
 * Correcting a contact in place: the mistyped mobile number, the email the
 * daughter gave at the second meeting. Before this, the only fix was to add
 * the same person twice.
 */
function ContactEditor({
  contact,
  pending,
  onSave,
  onCancel,
}: {
  contact: FamilyContact;
  pending: boolean;
  onSave: (data: {
    name: string;
    relationship: string | null;
    phone: string | null;
    email: string | null;
    role: "next_of_kin" | "contributor";
    canInvite?: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(contact.name);
  const [relationship, setRelationship] = useState(contact.relationship ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [role, setRole] = useState<"next_of_kin" | "contributor">(
    contact.role === "next_of_kin" ? "next_of_kin" : "contributor",
  );
  const id = `contact-${contact.id}`;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSave({
          name: name.trim(),
          relationship: relationship.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          role,
          // Changing the role carries the same rule as adding somebody: next
          // of kin may add family, a contributor may not.
          ...(role !== contact.role ? { canInvite: role === "next_of_kin" } : {}),
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-relationship`}>Relationship</Label>
          <Input
            id={`${id}-relationship`}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-phone`}>Mobile</Label>
          <Input
            id={`${id}-phone`}
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-email`}>Email</Label>
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-role`}>Role</Label>
        <Select
          value={role}
          onValueChange={(value) => setRole(value as "next_of_kin" | "contributor")}
        >
          <SelectTrigger id={`${id}-role`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="next_of_kin">Next of kin — the timeline is theirs</SelectItem>
            <SelectItem value="contributor">Contributor — can add photographs</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-sm leading-snug text-muted-foreground">
        Their link keeps working. A new number only matters the next time you
        text them.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save the changes
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
