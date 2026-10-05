import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatMoney,
  toCents,
  toDollars,
  type PlatformPlan,
} from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  usePageTitle,
} from "@/components/ui";

/**
 * The price list: the subscription plans Heather sells, with their monthly
 * and annual prices. The onboarding template's plan select reads from here,
 * and the agreed amount on a home's record is prefilled from the plan but
 * stays editable — every deal has its own handshake.
 *
 * Renaming a plan does not rewrite history: the home row records the plan's
 * name as free text, so an old "Standard" stays "Standard" even after the
 * price list changes.
 */
export function Plans() {
  usePageTitle("Plans");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get<{ plans: PlatformPlan[] }>("/admin/plans"),
  });

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PlatformPlan | null>(null);

  const refresh = () => {
    setAdding(false);
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ["plans"] });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Plans</h1>
          <p className="mt-1 max-w-prose text-sm text-[var(--muted-foreground)]">
            What you sell, at both cadences. The onboarding form offers these
            by name and prefills the amount; the amount on a home stays
            whatever you agreed with them.
          </p>
        </div>
        {!adding && !editing && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add a plan
          </Button>
        )}
      </div>

      {adding && <PlanForm onDone={refresh} />}
      {editing && <PlanForm plan={editing} onDone={refresh} />}

      {query.isPending ? (
        <LoadingRows rows={3} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.plans.length === 0 ? (
        <EmptyState
          title="No plans yet"
          detail="Without a price list the onboarding form just asks for a monthly or annual amount by hand. Add the plans you sell and the form will offer them by name."
          action={
            !adding && !editing ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add the first plan
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.plans.map((plan) => (
            <Card key={plan.id}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-lg">{plan.name}</h2>
                <div className="flex gap-1">
                  <Button variant="plain" onClick={() => setEditing(plan)}>
                    Edit
                  </Button>
                  <DeletePlan plan={plan} onDone={refresh} />
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-sm text-[var(--muted-foreground)]">
                    Monthly
                  </dt>
                  <dd className="tabular font-semibold">
                    {formatMoney(plan.monthlyAmountCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-[var(--muted-foreground)]">
                    Annual
                  </dt>
                  <dd className="tabular font-semibold">
                    {formatMoney(plan.annualAmountCents)}
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanForm({
  plan,
  onDone,
}: {
  plan?: PlatformPlan;
  onDone: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? "");
  const [monthly, setMonthly] = useState(
    plan ? toDollars(plan.monthlyAmountCents) : "",
  );
  const [annual, setAnnual] = useState(
    plan ? toDollars(plan.annualAmountCents) : "",
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        monthlyAmountCents: toCents(monthly),
        annualAmountCents: toCents(annual),
      };
      return plan
        ? api.put<PlatformPlan>(`/admin/plans/${plan.id}`, body)
        : api.post<PlatformPlan>("/admin/plans", body);
    },
    onSuccess: onDone,
  });

  const valid =
    name.trim().length > 0 &&
    monthly.trim() !== "" &&
    !Number.isNaN(parseFloat(monthly)) &&
    annual.trim() !== "" &&
    !Number.isNaN(parseFloat(annual));

  return (
    <Card>
      <h2 className="font-display text-lg">
        {plan ? `Edit “${plan.name}”` : "Add a plan"}
      </h2>
      <form
        className="mt-4 grid gap-5 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Name"
          required
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="“Standard”, “Plus”… the name the onboarding form shows."
        />
        <Field
          label="Monthly price"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          required
          value={monthly}
          onChange={(event) => setMonthly(event.target.value)}
          hint="Dollars per month."
        />
        <Field
          label="Annual price"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          required
          value={annual}
          onChange={(event) => setAnnual(event.target.value)}
          hint="Dollars per year."
        />
        {save.error instanceof Error && (
          <p
            role="alert"
            className="rounded-md bg-[var(--notice-soft)] p-3 text-sm text-[var(--notice)] sm:col-span-3"
          >
            {save.error.message}
          </p>
        )}
        <div className="flex gap-3 sm:col-span-3">
          <Button
            type="submit"
            variant="primary"
            disabled={save.isPending || !valid}
          >
            {save.isPending ? "Saving…" : plan ? "Save the plan" : "Add the plan"}
          </Button>
          <Button type="button" variant="plain" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DeletePlan({
  plan,
  onDone,
}: {
  plan: PlatformPlan;
  onDone: () => void;
}) {
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/plans/${plan.id}`),
    onSuccess: onDone,
  });

  return (
    <Button
      variant="plain"
      disabled={remove.isPending}
      onClick={() => {
        if (
          window.confirm(
            `Remove the “${plan.name}” plan? Homes already sold it keep their own records — this only takes it off the onboarding form.`,
          )
        ) {
          remove.mutate();
        }
      }}
    >
      Remove
    </Button>
  );
}
