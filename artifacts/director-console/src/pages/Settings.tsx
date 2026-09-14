import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHome,
  useUpdateHome,
  getGetHomeQueryKey,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { StandardSchedule } from "@/components/StandardSchedule";
import { BillingSection } from "@/components/BillingSection";
import { SnippetLibrary } from "@/components/SnippetLibrary";

/** "08:00" for a time input, from minutes since midnight. */
const toTimeInput = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const fromTimeInput = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * The home's settings: how the family portal is branded, when the home is
 * open, and whether closing a case starts the aftercare.
 *
 * Owner-only on the server, so a non-owner sees the values read-only rather
 * than a form that fails on save.
 */
export default function Settings() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const home = useGetHome();

  const update = useUpdateHome({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetHomeQueryKey() });
        void queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
      },
    },
  });

  if (home.isPending) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!home.data) return null;

  const row = home.data;
  const readOnly = session?.user.role !== "owner";
  const save = (data: Record<string, unknown>) => update.mutate({ data: data as never });

  return (
    <div className="max-w-2xl space-y-8">
      <header>
        <h1 className="font-display text-2xl mb-1">Settings</h1>
        <p className="text-muted-foreground">
          {readOnly
            ? "Only an owner can change these."
            : "How families see you, and when you are open."}
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">How families see you</h2>

        <div className="space-y-1.5">
          <Label htmlFor="name">Funeral home</Label>
          <Input
            id="name"
            disabled={readOnly}
            defaultValue={row.name}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== row.name) save({ name: value });
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="accentColor">Brand colour</Label>
          <div className="flex items-center gap-3">
            <Input
              id="accentColor"
              type="color"
              disabled={readOnly}
              defaultValue={row.accentColor}
              className="h-10 w-16 p-1"
              onBlur={(event) => save({ accentColor: event.target.value })}
            />
            <span className="text-sm text-muted-foreground">
              Used across the family's portal.
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="phone">Office number</Label>
            <Input
              id="phone"
              type="tel"
              disabled={readOnly}
              defaultValue={row.phone ?? ""}
              onBlur={(event) => save({ phone: event.target.value.trim() || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="urgentPhone">24-hour number</Label>
            <Input
              id="urgentPhone"
              type="tel"
              disabled={readOnly}
              defaultValue={row.urgentPhone ?? ""}
              onBlur={(event) =>
                save({ urgentPhone: event.target.value.trim() || null })
              }
            />
            <p className="text-xs text-muted-foreground">
              Shown on every screen a family sees, and beside the out-of-hours
              notice.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">Office hours</h2>
        <p className="text-sm text-muted-foreground">
          These never hold a message back. A family writing at two in the
          morning is told, before they send, that you read messages from the
          time below — and offered the 24-hour number if it cannot wait.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="opens">Open from</Label>
            <Input
              id="opens"
              type="time"
              disabled={readOnly}
              defaultValue={toTimeInput(row.officeOpensMinute)}
              onBlur={(event) => {
                const minute = fromTimeInput(event.target.value);
                if (minute !== null) save({ officeOpensMinute: minute });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="closes">Until</Label>
            <Input
              id="closes"
              type="time"
              disabled={readOnly}
              defaultValue={toTimeInput(row.officeClosesMinute)}
              onBlur={(event) => {
                const minute = fromTimeInput(event.target.value);
                if (minute !== null) save({ officeClosesMinute: minute });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              disabled={readOnly}
              defaultValue={row.timezone}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== row.timezone) save({ timezone: value });
              }}
            />
          </div>
        </div>
      </section>

      <StandardSchedule readOnly={readOnly} />

      <SnippetLibrary readOnly={readOnly} />

      <BillingSection readOnly={readOnly} />

      {/*
        A public page nobody knows about is a public page that does nothing.
        This is where a home finds out it has one, and gets the address to put
        on their own website.
      */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">Your public page</h2>
        <p className="text-sm text-muted-foreground">
          Put this on your website, so a family who has just had a death — or
          someone planning their own funeral in advance — can reach you without
          waiting for office hours. Your telephone number is at the top of it,
          above the form.
        </p>

        <PublicPageLink slug={row.slug} />

        <label className="flex items-start gap-3">
          <Switch
            checked={row.intakeEnabled}
            disabled={readOnly}
            onCheckedChange={(checked) => save({ intakeEnabled: checked })}
          />
          <span className="text-sm">
            <span className="block font-medium">
              Take requests through the page
            </span>
            <span className="block text-muted-foreground">
              Turn this off if you would rather every first contact were a phone
              call. The page still works and still shows your number — it just
              offers the telephone instead of a form.
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="intakeNotifyEmail">Send requests to</Label>
          <Input
            id="intakeNotifyEmail"
            type="email"
            disabled={readOnly}
            placeholder="Falls back to the owner's address"
            defaultValue={row.intakeNotifyEmail ?? ""}
            onBlur={(event) =>
              save({ intakeNotifyEmail: event.target.value.trim() || null })
            }
          />
          <p className="text-xs text-muted-foreground">
            Whoever checks email during the day. A request sitting in a queue
            nobody opens is worse than no form at all — the family believes they
            have reached someone.
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">Aftercare</h2>

        <label className="flex items-start gap-3">
          <Switch
            checked={row.aftercareEnabled}
            disabled={readOnly}
            onCheckedChange={(checked) => save({ aftercareEnabled: checked })}
          />
          <span className="text-sm">
            <span className="block font-medium">
              Offer grief check-ins when a case closes
            </span>
            <span className="block text-muted-foreground">
              Gentle check-ins at 30, 60 and 90 days, and on the anniversary —
              sent in your name, with no staff time from you. Families are
              asked first, and nothing goes out until they say yes.
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="senderName">Signed</Label>
          <Input
            id="senderName"
            disabled={readOnly}
            placeholder={row.name}
            defaultValue={row.aftercareSenderName ?? ""}
            onBlur={(event) =>
              save({ aftercareSenderName: event.target.value.trim() || null })
            }
          />
          <p className="text-xs text-muted-foreground">
            "Provided in care with {row.aftercareSenderName?.trim() || row.name}".
            Leave blank to use the home's name.
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * The address a home puts on their own website.
 *
 * Built from the family portal's origin at runtime rather than stored,
 * because the console and the portal are different hostnames and only the
 * deployment knows the second one. `VITE_FAMILY_PORTAL_URL` is read if the
 * build set it; otherwise this shows the path and says where it goes, which
 * is honest rather than confidently wrong.
 */
function PublicPageLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const configured = import.meta.env["VITE_FAMILY_PORTAL_URL"] as
    | string
    | undefined;
  const origin = configured?.replace(/\/+$/, "");
  const url = `${origin ?? ""}/start/${slug}`;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <code className="flex-1 rounded border bg-muted px-3 py-2 text-xs break-all">
          {url}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {!origin && (
        <p className="text-xs text-muted-foreground">
          Add your family portal&rsquo;s address in front of that path — it is
          the site your families open their texted links on.
        </p>
      )}
    </div>
  );
}
