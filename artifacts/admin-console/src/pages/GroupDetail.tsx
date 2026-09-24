import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  api,
  describeAccount,
  describeContract,
  isNotFound,
  plural,
  type AdminGroupDetail,
} from "@/lib/api";
import { BASE_PATH } from "@/lib/base";
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  Missing,
  Skeleton,
  Swatch,
} from "@/components/ui";

/**
 * One group: its locations, and its contract.
 *
 * Locations are moved in and out from each home's own page, not from here.
 * That is deliberate: moving a home changes who pays for it, and the home's
 * page is where its own subscription, suspension and staff are in view when
 * that decision is made.
 */
export function GroupDetail({ groupId }: { groupId: number }) {
  const query = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api.get<AdminGroupDetail>(`/admin/groups/${groupId}`),
    retry: false,
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <LoadingRows rows={3} />
      </div>
    );
  }

  if (isNotFound(query.error)) {
    return (
      <Missing
        title="That group isn't here"
        detail="There is no group at this address. It may have been typed wrong."
        back={{ href: "/groups", label: "Back to the groups" }}
      />
    );
  }

  if (query.error) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        <Link href="/groups" className="text-sm underline">
          Back to the groups
        </Link>
      </div>
    );
  }

  const group = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/groups"
          className="text-sm text-[var(--muted-foreground)] hover:underline"
        >
          ← Groups
        </Link>
        <h1 className="mt-2 font-display text-2xl break-words">{group.name}</h1>
        <p className="mt-1 text-[var(--muted-foreground)]">
          {describeContract(group)} · {plural(group.locations.length, "location")}
        </p>
      </div>

      <ReturnedFromStripe />

      <Card>
        <CardTitle>Locations</CardTitle>
        {group.locations.length === 0 ? (
          <EmptyState
            title="No locations yet"
            detail="Open each of their homes and choose “Move into a group”. A home moves onto this group's contract the moment it joins."
            action={
              <Link
                href="/homes"
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                Find their homes
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {group.locations.map((home) => (
              <li
                key={home.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/homes/${home.id}`}
                    className="inline-flex items-center gap-2 font-semibold no-underline hover:underline"
                  >
                    <Swatch color={home.accentColor} name={home.name} />
                    <span className="break-words">{home.name}</span>
                  </Link>
                  {(home.city || home.region) && (
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {[home.city, home.region].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {describeAccount(home)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Contract group={group} />
    </div>
  );
}

/**
 * Back from Stripe. Stripe adds `?billing=done` or `?billing=cancelled` to
 * the address it returns to; without a line here the page would look
 * exactly as it did before, and "did that work?" would be a question.
 */
function ReturnedFromStripe() {
  const params = new URLSearchParams(useSearch());
  const billing = params.get("billing");

  if (billing === "done") {
    return (
      <p role="status" className="max-w-prose text-sm">
        The subscription was set up in Stripe. It can take a minute to show
        here, once Stripe tells us it has started.
      </p>
    );
  }

  if (billing === "cancelled") {
    return (
      <p role="status" className="max-w-prose text-sm text-[var(--muted-foreground)]">
        The checkout was left without subscribing. Nothing was charged.
      </p>
    );
  }

  return null;
}

/**
 * The contract, and how it starts.
 *
 * Starting it hands over to Stripe's own checkout, with one base line per
 * location and the chosen add-ons, and the group's billing contact pays
 * there -- nobody types a card into this console. Once it is running,
 * changes to it are made in Stripe, which is where the invoice lives.
 */
function Contract({ group }: { group: AdminGroupDetail }) {
  const [email, setEmail] = useState("");
  const [addOns, setAddOns] = useState<string[]>([]);

  const checkout = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>(`/admin/groups/${group.id}/checkout`, {
        email: email.trim(),
        addOns,
        returnUrl: `${window.location.origin}${BASE_PATH}/groups/${group.id}`,
      }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  const included = group.addOns.filter((addOn) => addOn.included);

  if (group.hasSubscription) {
    return (
      <Card>
        <CardTitle>Contract</CardTitle>
        <p className="max-w-prose">
          {describeContract(group)}, for {plural(group.locations.length, "location")}.
        </p>
        <p className="mt-2 max-w-prose text-sm text-[var(--muted-foreground)]">
          {included.length > 0
            ? `Includes ${included.map((addOn) => addOn.title).join(", ")}. `
            : "No add-ons. "}
          Changes to the contract — locations billed, add-ons, the card — are
          made in Stripe, and every location follows it automatically.
        </p>
      </Card>
    );
  }

  const blocked = !group.billingConfigured
    ? "Billing is not set up on this deployment, so a contract cannot be started from here. Every location keeps working on the group's trial meanwhile."
    : group.locations.length === 0
      ? "Move at least one location in first: the contract is billed per location."
      : null;

  return (
    <Card>
      <CardTitle>Start the contract</CardTitle>
      <p className="mb-5 max-w-prose text-sm text-[var(--muted-foreground)]">
        {`This opens Stripe's checkout for ${plural(group.locations.length, "location")}, one base line each, plus any add-ons chosen below. The group's billing contact enters their own card there. Until then, every location is on the group's trial.`}
      </p>

      {blocked ? (
        <p className="max-w-prose rounded-xl border border-[var(--border)] bg-[var(--sunken)] p-5 text-sm leading-relaxed">
          {blocked}
        </p>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            checkout.mutate();
          }}
        >
          <div className="max-w-md">
            <Field
              label="Billing contact's email address"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              hint="Stripe sends the invoices here."
            />
          </div>

          {group.addOns.length > 0 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-semibold">Add-ons</legend>
              {group.addOns.map((addOn) => {
                const id = `add-on-${addOn.key}`;
                const checked = addOns.includes(addOn.key);
                return (
                  <div key={addOn.key} className="flex items-start gap-3">
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAddOns((current) =>
                          checked
                            ? current.filter((key) => key !== addOn.key)
                            : [...current, addOn.key],
                        )
                      }
                      className="mt-1 size-5 accent-[var(--accent)]"
                    />
                    <label htmlFor={id} className="max-w-prose">
                      <span className="font-semibold">{addOn.title}</span>
                      <span className="block text-sm text-[var(--muted-foreground)]">
                        For every location in the group.
                      </span>
                    </label>
                  </div>
                );
              })}
            </fieldset>
          )}

          {checkout.error instanceof Error && (
            <p role="alert" className="max-w-prose text-sm text-[var(--notice)]">
              {checkout.error.message}
            </p>
          )}

          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={checkout.isPending || checkout.isSuccess || !email.trim()}
            >
              {checkout.isPending || checkout.isSuccess
                ? "Opening Stripe…"
                : "Continue to Stripe"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
