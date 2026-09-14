import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPolicies,
  useCreatePolicy,
  useUpdatePolicy,
  useGetPolicyVersions,
  usePublishPolicyVersion,
  getGetPoliciesQueryKey,
  getGetPolicyVersionsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";

/**
 * The home's standing documents: their privacy notice, their terms, the
 * disclosures their attorney wrote.
 *
 * Versions are immutable. New wording is a new version rather than an edit,
 * because the only question anybody ever asks about one of these is "what did
 * you show them, and when" — and a record that points at a document somebody
 * can still edit answers that question with nothing.
 *
 * As everywhere else here, we supply none of the words.
 */

const KINDS = [
  { value: "privacy", label: "Privacy notice" },
  { value: "terms", label: "Terms" },
  { value: "price_disclosure", label: "Price disclosure" },
  { value: "other", label: "Something else" },
];

const formatDay = (value: string | Date) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

function Versions({ policyId, readOnly }: { policyId: number; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const versions = useGetPolicyVersions(policyId);
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");

  const publish = usePublishPolicyVersion({
    mutation: {
      onSuccess: () => {
        setBody("");
        setSummary("");
        void queryClient.invalidateQueries({
          queryKey: getGetPolicyVersionsQueryKey(policyId),
        });
        void queryClient.invalidateQueries({ queryKey: getGetPoliciesQueryKey() });
      },
    },
  });

  if (versions.isPending) {
    return (
      <p className="py-3 text-center">
        <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
      </p>
    );
  }

  const rows = versions.data ?? [];

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <ul className="space-y-2 text-sm">
        {rows.map((version) => (
          <li key={version.id}>
            <p className="font-medium">
              Version {version.version}
              <span className="font-normal text-muted-foreground">
                {" · "}
                {formatDay(version.publishedAt)}
                {version.publishedByName ? ` · ${version.publishedByName}` : ""}
              </span>
            </p>
            {version.summary && (
              <p className="text-muted-foreground">{version.summary}</p>
            )}
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground max-w-prose">
              {version.body}
            </p>
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="space-y-2">
          <Textarea
            rows={4}
            aria-label="The new wording"
            placeholder="The new wording, in full"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <Input
            aria-label="What changed"
            placeholder="What changed, for your own records"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Publishing this leaves every earlier version exactly as it was, so
            a family who read the old one still points at the words they read.
          </p>
          <Button
            size="sm"
            disabled={publish.isPending || body.trim() === ""}
            onClick={() =>
              publish.mutate({
                policyId,
                data: { body: body.trim(), summary: summary.trim() || null },
              })
            }
          >
            Publish version {rows.length + 1}
          </Button>
        </div>
      )}
    </div>
  );
}

export function PolicyLibrary({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient();
  const policies = useGetPolicies();

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("privacy");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetPoliciesQueryKey() });

  const add = useCreatePolicy({
    mutation: {
      onSuccess: (created) => {
        setTitle("");
        setBody("");
        setOpen(created.id);
        refresh();
      },
    },
  });
  const update = useUpdatePolicy({ mutation: { onSuccess: refresh } });

  const rows = (policies.data ?? []).filter((policy) => policy.retiredAt === null);

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-medium">Your documents</h2>
        <p className="text-sm text-muted-foreground">
          Your privacy notice, your terms, your disclosures — in your own
          words, as always. Families read them in the portal, and we keep a
          record of who was shown which version and when.
        </p>
      </div>

      {policies.isPending ? (
        <p className="py-4 text-center">
          <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Most homes start with the privacy notice they
          already hand across the desk.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((policy) => (
            <li key={policy.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{policy.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {policy.currentVersion
                      ? `Version ${policy.currentVersion.version} · published ${formatDay(
                          policy.currentVersion.publishedAt,
                        )}`
                      : "No wording yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(open === policy.id ? null : policy.id)}
                  >
                    {open === policy.id ? "Close" : "Versions"}
                  </Button>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update.mutate({
                          policyId: policy.id,
                          data: { retired: true },
                        })
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>

              {open === policy.id && (
                <Versions policyId={policy.id} readOnly={readOnly} />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            <Input
              className="flex-1 min-w-48"
              aria-label="What the document is called"
              placeholder="What you call it — 'How we look after your photographs'"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-48" aria-label="What kind of document">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            rows={4}
            aria-label="The wording"
            placeholder="The wording, in full. This becomes version 1."
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <Button
            disabled={add.isPending || title.trim() === "" || body.trim() === ""}
            onClick={() =>
              add.mutate({
                data: {
                  title: title.trim(),
                  kind: kind as "privacy",
                  body: body.trim(),
                },
              })
            }
          >
            <Plus className="size-4" />
            Add it
          </Button>
        </div>
      )}
    </section>
  );
}
