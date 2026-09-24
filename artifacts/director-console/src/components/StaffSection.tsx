import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStaff,
  useInviteStaff,
  useUpdateStaff,
  useResendStaffInvite,
  getGetStaffQueryKey,
  getGetBillingQueryKey,
  type StaffMember,
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
import { Copy, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Loading } from "@/components/page";

/**
 * Who works here, and the one place a colleague can be added.
 *
 * The API for this has existed since the home could have more than one
 * person, and the setup checklist has always asked a new home to "invite your
 * colleagues" and sent them here -- to a screen with nothing on it that did
 * so. A home's second director could only be added with curl. This is that
 * screen.
 *
 * The invitation is the ordinary single-use password link, emailed, and also
 * shown here once, because for a funeral home on a shared mail host the email
 * lands in spam more often than not and an owner standing next to the new
 * hire should be able to hand it over. It lasts a week, so anyone who has
 * not yet chosen a password gets a "Send a new invitation" button in the list
 * below: a colleague who finds the email after it has run out should not have
 * to be told to use "I've forgotten my password" on their first day.
 */

const ROLE_LABEL: Record<StaffMember["role"], string> = {
  owner: "Owner",
  director: "Director",
  staff: "Staff",
};

export function StaffSection({
  readOnly,
  currentUserId,
}: {
  readOnly: boolean;
  currentUserId: number | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const staff = useGetStaff();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<"director" | "staff" | "owner">("director");
  const [lastInvite, setLastInvite] = useState<{ email: string; link: string } | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetStaffQueryKey() });
    // The setup checklist lives on the billing payload.
    void queryClient.invalidateQueries({ queryKey: getGetBillingQueryKey() });
  };

  const invite = useInviteStaff({
    mutation: {
      onSuccess: (created) => {
        setLastInvite({ email: created.email, link: created.inviteLink });
        setEmail("");
        setDisplayName("");
        setTitle("");
        setRole("director");
        refresh();
      },
    },
  });

  const update = useUpdateStaff({ mutation: { onSuccess: refresh } });

  const resend = useResendStaffInvite({
    mutation: {
      onSuccess: (sent) => {
        setLastInvite({ email: sent.email, link: sent.inviteLink });
        refresh();
      },
    },
  });

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Copied", description: "Paste it into a message to them." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the link and copy it by hand.",
        variant: "destructive",
      });
    }
  };

  return (
    <section
      aria-labelledby="staff-heading"
      className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]"
    >
      <div className="space-y-1">
        <h2 id="staff-heading" className="font-display text-lg">
          Who works here
        </h2>
        <p className="text-sm leading-snug text-muted-foreground">
          Everyone here sees every case. Each person chooses their own
          password from the link they are sent.
        </p>
      </div>

      {staff.isPending ? (
        <Loading rows={2} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(staff.data ?? []).map((member) => {
            const hasPassword = member.hasPassword;
            const inactive = member.deactivatedAt !== null;
            const isMe = member.id === currentUserId;

            return (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.displayName || member.email}
                    {isMe && (
                      <span className="font-normal text-muted-foreground"> (you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[member.title, member.displayName ? member.email : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {!hasPassword && !inactive && (
                    <p className="text-xs text-muted-foreground">
                      Hasn't chosen a password yet.
                      {readOnly
                        ? " The owner can send them a new invitation."
                        : " Their invitation lasts a week; send a new one if it has run out."}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {inactive ? "No longer has access" : ROLE_LABEL[member.role]}
                </span>
                {!readOnly && !hasPassword && !inactive && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={resend.isPending}
                    aria-label={`Send ${member.displayName || member.email} a new invitation`}
                    onClick={() => resend.mutate({ userId: member.id })}
                  >
                    {resend.isPending && resend.variables?.userId === member.id
                      ? "Sending…"
                      : "Send a new invitation"}
                  </Button>
                )}
                {!readOnly && !isMe && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={update.isPending}
                    aria-label={
                      inactive
                        ? `Give ${member.displayName || member.email} access again`
                        : `Take away ${member.displayName || member.email}'s access`
                    }
                    onClick={() =>
                      update.mutate({
                        userId: member.id,
                        data: { active: inactive },
                      })
                    }
                  >
                    {inactive ? "Restore access" : "Remove access"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {lastInvite && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-dashed border-border p-3"
        >
          <p className="text-sm">
            We've emailed <span className="font-medium">{lastInvite.email}</span>{" "}
            a link to choose a password. If it doesn't arrive, send them this
            one — it works once, for a week, and won't be shown again.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label="Invitation link"
              value={lastInvite.link}
              onFocus={(event) => event.target.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copy(lastInvite.link)}
            >
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        </div>
      )}

      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          Only an owner can add people or take access away.
        </p>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const address = email.trim();
            if (!address || invite.isPending) return;
            invite.mutate({
              data: {
                email: address,
                displayName: displayName.trim() || null,
                title: title.trim() || null,
                role,
              },
            });
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="inviteEmail">Their email</Label>
            <Input
              id="inviteEmail"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inviteName">Name</Label>
            <Input
              id="inviteName"
              autoComplete="off"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inviteTitle">Title families see</Label>
            <Input
              id="inviteTitle"
              placeholder="Funeral Director"
              autoComplete="off"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inviteRole">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
              <SelectTrigger id="inviteRole" aria-label="Role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="director">Director</SelectItem>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="owner">Owner — can change settings and add people</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={invite.isPending || !email.trim()}>
              <Plus className="size-4" />
              Add them
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
