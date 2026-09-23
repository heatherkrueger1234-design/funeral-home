import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHome,
  useUpdateHome,
  useGetHomePolicies,
  useCreateHomePolicy,
  useUpdateHomePolicy,
  useDeleteHomePolicy,
  getGetHomeQueryKey,
  getGetHomePoliciesQueryKey,
} from "@workspace/api-client-react";
import type { HomePolicy } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loading, PageHeader, Panel } from "@/components/page";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";

/**
 * The home's own page, and the sentences it repeats at every kitchen table.
 *
 * Two things live here and they behave differently, which the screen has to
 * make obvious. The words at the top are published the moment they are saved;
 * a policy section is a draft until somebody deliberately publishes it,
 * because the first version of the paragraph about money is never the one to
 * put on the internet.
 *
 * What is *not* here is a price. The home's prices are on their own screen,
 * staff-only, and the note at the bottom of this page says so out loud — a
 * director who expected to type prices into their "storefront" should find
 * out why from this page rather than by looking for the field.
 */

export default function Storefront() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const home = useGetHome();
  const policies = useGetHomePolicies();

  const readOnly = session?.user.role !== "owner";

  const update = useUpdateHome({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetHomeQueryKey() }),
    },
  });

  if (home.isPending || policies.isPending) return <Loading rows={4} />;

  if (!home.data) return null;

  const row = home.data;
  const save = (data: Record<string, unknown>) =>
    update.mutate({ data: data as never });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <PageHeader title="Your page">
        {readOnly
          ? "Only an owner can change what the home publishes."
          : "What a family reads before they ring you, and what you find yourself explaining every time."}
      </PageHeader>

      <PublicPageLink slug={row.slug} />

      <Panel className="space-y-4">
        <div>
          <h2 className="font-display text-lg">What it says</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Somebody reaching this page has usually had a death in the last few
            hours. What they need off it is that they have the right place and
            that a person will answer — not that you are compassionate, which
            every home says. Both boxes can be left empty; your name, address
            and telephone number are on the page regardless.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="headline">One line</Label>
          <Input
            id="headline"
            disabled={readOnly}
            maxLength={160}
            placeholder="Serving Jefferson County since 1946"
            defaultValue={row.storefrontHeadline ?? ""}
            onBlur={(event) =>
              save({ storefrontHeadline: event.target.value.trim() || null })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="about">A paragraph or two</Label>
          <Textarea
            id="about"
            rows={5}
            disabled={readOnly}
            maxLength={4000}
            placeholder="Who answers the telephone, what happens when someone rings at three in the morning, where to park."
            defaultValue={row.storefrontAbout ?? ""}
            onBlur={(event) =>
              save({ storefrontAbout: event.target.value.trim() || null })
            }
          />
          <p className="text-sm leading-snug text-muted-foreground">
            Saved as you leave the box, and live on your page straight away.
          </p>
        </div>
      </Panel>

      <Policies rows={policies.data ?? []} readOnly={readOnly} />

      <Panel className="space-y-4">
        <h2 className="font-display text-lg">Taking requests</h2>

        <label className="flex items-start gap-3">
          <Switch
            checked={row.intakeEnabled}
            disabled={readOnly}
            onCheckedChange={(checked) => save({ intakeEnabled: checked })}
          />
          <span className="text-sm">
            <span className="block font-medium">
              Let someone ask through the page
            </span>
            <span className="block text-muted-foreground">
              Turn this off if you would rather every first contact were a
              phone call. The page still works and still shows your number — it
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
          <p className="text-sm leading-snug text-muted-foreground">
            Whoever checks email during the day. A request sitting in a queue
            nobody opens is worse than no form at all — the family believes
            they have reached someone. When a family replies to one of your
            aftercare check-ins, the reply comes here too.
          </p>
        </div>
      </Panel>

      {/*
        Said here rather than left as a missing field. A director who came to
        this screen expecting to type prices should find out why they are not
        here, from here.
      */}
      <p className="rounded-xl border border-border bg-[var(--sunken)] p-5 text-sm leading-snug text-muted-foreground">
        Your prices are not on this page, and cannot be put on it. The FTC
        Funeral Rule governs how a funeral provider discloses prices, and it
        is not something a text box should be doing on your behalf. Your own
        price sheet — for your staff, at a kitchen table — is under{" "}
        <span className="font-medium">Prices</span>.
      </p>
    </div>
  );
}

/**
 * The policy sections.
 *
 * Draft and published are distinguished at a glance rather than by reading a
 * switch label, because the mistake this screen has to prevent is publishing
 * the wrong paragraph, and that mistake is made by skimming.
 */
function Policies({
  rows,
  readOnly,
}: {
  rows: HomePolicy[];
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetHomePoliciesQueryKey(),
    });

  const add = useCreateHomePolicy({ mutation: { onSuccess: () => {
    setTitle("");
    refresh();
  } } });
  const update = useUpdateHomePolicy({ mutation: { onSuccess: refresh } });
  const remove = useDeleteHomePolicy({ mutation: { onSuccess: refresh } });

  const heading = title.trim();

  return (
    <Panel className="space-y-4">
      <div>
        <h2 className="font-display text-lg">What you say every time</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Deposits, bringing clothing in, whether children come to a viewing.
          Written once, so every family gets the same answer and you can point
          at it. New sections start as drafts — nothing is on your page until
          you publish it.
        </p>
      </div>

      <ul className="space-y-3">
        {rows.map((policy) => (
          <li
            key={policy.id}
            className={`space-y-2 rounded-xl border p-3 ${
              policy.published
                ? "border-border bg-card"
                : "border-dashed border-border bg-[var(--sunken)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Input
                disabled={readOnly}
                defaultValue={policy.title}
                className="font-medium"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== policy.title) {
                    update.mutate({ policyId: policy.id, data: { title: value } });
                  }
                }}
              />
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove section"
                  onClick={() => remove.mutate({ policyId: policy.id })}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>

            <Textarea
              rows={4}
              disabled={readOnly}
              defaultValue={policy.body}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== policy.body) {
                  update.mutate({ policyId: policy.id, data: { body: value } });
                }
              }}
            />

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={policy.published}
                disabled={readOnly}
                onCheckedChange={(checked) =>
                  update.mutate({
                    policyId: policy.id,
                    data: { published: checked },
                  })
                }
              />
              {policy.published ? (
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="size-4" />
                  On your page, and in every family&rsquo;s portal
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <EyeOff className="size-4" />
                  Draft — only your staff can see this
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="flex gap-2">
          <Input
            value={title}
            placeholder="Add a section — e.g. Cremation timings"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && heading) {
                add.mutate({
                  data: { title: heading, body: "Write it the way you say it." },
                });
              }
            }}
          />
          <Button
            variant="outline"
            disabled={!heading || add.isPending}
            onClick={() =>
              add.mutate({
                data: { title: heading, body: "Write it the way you say it." },
              })
            }
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      )}
    </Panel>
  );
}

/**
 * The address a home puts on their own website.
 *
 * Built from the family portal's origin at runtime rather than stored,
 * because the console and the portal are different hostnames and only the
 * deployment knows the second one.
 */
function PublicPageLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const configured = import.meta.env["VITE_FAMILY_PORTAL_URL"] as
    | string
    | undefined;
  const origin = configured?.replace(/\/+$/, "");
  const url = `${origin ?? ""}/start/${slug}`;

  return (
    <Panel className="space-y-2">
      <h2 className="font-display text-lg">Where it lives</h2>
      <p className="text-sm text-muted-foreground">
        Put this on your own website, so a family who has just had a death can
        reach you at two in the morning.
      </p>
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
        <p className="text-sm leading-snug text-muted-foreground">
          Add your family portal&rsquo;s address in front of that path — it is
          the site your families open their texted links on.
        </p>
      )}
    </Panel>
  );
}
