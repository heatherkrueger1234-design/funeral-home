import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCaseContact,
  useReissueContactLink,
  useSendContactLink,
  useRevokeContact,
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
import { Check, Copy, Link2, Loader2, MessageSquare, UserPlus } from "lucide-react";

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
  const { toast } = useToast();
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

  const reissue = useReissueContactLink({
    mutation: {
      onSuccess: (updated) => {
        setFreshLink(updated.link);
        setLastPhone(updated.phone);
        refresh();
      },
    },
  });

  const revoke = useRevokeContact({ mutation: { onSuccess: refresh } });

  const sendLink = useSendContactLink({
    mutation: {
      onSuccess: (result) => {
        setFreshLink(result.link);
        setLastPhone(result.phone);
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
      {freshLink && <LinkOnce link={freshLink} phone={lastPhone} />}

      {contacts.length > 0 && (
        <ul className="space-y-2">
          {contacts.map((contact) => {
            const revoked = contact.revokedAt !== null;
            const opened = contact.firstSeenAt !== null;

            return (
              <li
                key={contact.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3"
              >
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
                    {contact.phone ? ` · ${contact.phone}` : ""}
                    {/* Whether the text ever landed — otherwise invisible
                        until the family fails to do anything. */}
                    {revoked
                      ? " · link revoked"
                      : opened
                        ? " · link opened"
                        : " · not opened yet"}
                  </span>
                </span>

                <span className="flex shrink-0 gap-1">
                  {contact.phone && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={sendLink.isPending}
                      onClick={() =>
                        sendLink.mutate({ contactId: contact.id })
                      }
                    >
                      {sendLink.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <MessageSquare className="size-4" />
                      )}
                      Text it
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => reissue.mutate({ contactId: contact.id })}
                  >
                    <Link2 className="size-4" />
                    {revoked ? "New link" : "Copy a new one"}
                  </Button>
                  {!revoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => revoke.mutate({ contactId: contact.id })}
                    >
                      Revoke
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="space-y-4 rounded-xl border border-border bg-card p-4"
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
            <p className="text-xs text-muted-foreground">
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
            <SelectTrigger>
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
