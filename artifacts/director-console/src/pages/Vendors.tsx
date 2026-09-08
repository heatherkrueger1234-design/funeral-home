import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetVendors,
  useCreateVendor,
  useUpdateVendor,
  useArchiveVendor,
  useLookupPlaces,
  getGetVendorsQueryKey,
  getLookupPlacesQueryKey,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MapPin, Plus, Search, Star, Trash2 } from "lucide-react";

/**
 * The home's local network.
 *
 * "Who do you recommend for a headstone?" is one of the most common questions
 * a family asks, it gets asked weeks after the funeral when the case is
 * closed, and the answer usually lives in one director's memory. A home whose
 * referrals outlive its staff is worth more than one whose don't.
 *
 * The directory starts empty on purpose. There is no public-domain nationwide
 * list of monument makers or celebrants, and seeding invented ones into a
 * tool that hands them to bereaved families would be indefensible — so either
 * a director types someone they know, or they look one up live.
 */

const KINDS = [
  { value: "monument", label: "Headstones & monuments" },
  { value: "cemetery", label: "Cemeteries" },
  { value: "casket", label: "Caskets" },
  { value: "urn", label: "Urns" },
  { value: "clergy", label: "Clergy" },
  { value: "celebrant", label: "Celebrants" },
  { value: "florist", label: "Florists" },
  { value: "musician", label: "Musicians" },
  { value: "caterer", label: "Caterers" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
];

export default function Vendors() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();

  const [kind, setKind] = useState("monument");
  const [near, setNear] = useState(session?.home.postalCode ?? "");
  const [lookupOpen, setLookupOpen] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const vendors = useGetVendors({ kind: kind as "monument", near: near || undefined });

  const lookup = useLookupPlaces(
    { kind: kind as "monument", near },
    {
      query: {
        queryKey: getLookupPlacesQueryKey({ kind: kind as "monument", near }),
        // Only when actually asked for: a provider lookup is a paid call.
        enabled: lookupOpen && near.trim().length >= 5,
      },
    },
  );

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetVendorsQueryKey() });

  const create = useCreateVendor({
    mutation: {
      onSuccess: () => {
        setName("");
        setPhone("");
        setPostalCode("");
        refresh();
      },
      onError: (error) =>
        toast({
          title: "Couldn't save that",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        }),
    },
  });
  const update = useUpdateVendor({ mutation: { onSuccess: refresh } });
  const archive = useArchiveVendor({ mutation: { onSuccess: refresh } });

  const rows = vendors.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">Local network</h1>
        <p className="text-muted-foreground">
          Who you'd point a family to. Anything switched on for families shows
          in their portal, nearest first.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-[15rem]">
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

        <div className="space-y-1.5">
          <Label htmlFor="near">Near ZIP</Label>
          <Input
            id="near"
            value={near}
            placeholder="80202"
            className="w-[8rem]"
            inputMode="numeric"
            onChange={(event) => setNear(event.target.value)}
          />
        </div>

        <Button
          variant="outline"
          className="ml-auto"
          disabled={near.trim().length < 5}
          onClick={() => setLookupOpen((open) => !open)}
        >
          <Search className="size-4" />
          Find nearby
        </Button>
      </div>

      {lookupOpen && (
        <section className="rounded-xl border border-border bg-card p-4">
          {lookup.isPending ? (
            <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
          ) : lookup.data?.configured === false ? (
            <p className="text-sm text-muted-foreground">
              {lookup.data.message} Nothing is invented here — a made-up name
              and number handed to a grieving family would be worse than an
              empty list.
            </p>
          ) : (
            <ul className="space-y-2">
              {(lookup.data?.results ?? []).map((candidate) => (
                <li
                  key={candidate.sourceRef}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {candidate.name}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[candidate.addressLine1, candidate.city, candidate.region]
                        .filter(Boolean)
                        .join(", ")}
                      {candidate.phone ? ` · ${candidate.phone}` : ""}
                      {candidate.distanceMiles !== null
                        ? ` · ${candidate.distanceMiles} mi`
                        : ""}
                    </span>
                  </span>

                  <Button
                    size="sm"
                    variant={candidate.alreadySaved ? "ghost" : "outline"}
                    disabled={candidate.alreadySaved}
                    onClick={() =>
                      create.mutate({
                        data: {
                          kind: kind as "monument",
                          name: candidate.name,
                          phone: candidate.phone,
                          website: candidate.website,
                          addressLine1: candidate.addressLine1,
                          city: candidate.city,
                          region: candidate.region,
                          postalCode: candidate.postalCode,
                          source: "places",
                          sourceRef: candidate.sourceRef,
                        },
                      })
                    }
                  >
                    {candidate.alreadySaved ? "Saved" : "Save"}
                  </Button>
                </li>
              ))}
              {(lookup.data?.results ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">
                  {lookup.data?.message ?? "Nothing found near that ZIP."}
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {vendors.isPending ? (
        <div className="py-12 text-center">
          <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
          Nobody here yet. Add someone you'd actually recommend.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((vendor) => (
            <li
              key={vendor.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{vendor.name}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {[vendor.city, vendor.region].filter(Boolean).join(", ")}
                  {vendor.phone ? ` · ${vendor.phone}` : ""}
                  {vendor.distanceMiles !== null ? (
                    <>
                      {" · "}
                      <MapPin className="inline size-3" /> {vendor.distanceMiles} mi
                    </>
                  ) : vendor.postalCode ? (
                    " · location unknown"
                  ) : (
                    ""
                  )}
                </span>
              </span>

              <Button
                variant="ghost"
                size="sm"
                title="Recommend this one first"
                onClick={() =>
                  update.mutate({
                    vendorId: vendor.id,
                    data: { kind: vendor.kind, name: vendor.name, preferred: !vendor.preferred },
                  })
                }
              >
                <Star
                  className={vendor.preferred ? "size-4 fill-current" : "size-4"}
                />
              </Button>

              <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                <Switch
                  checked={vendor.visibleToFamily}
                  onCheckedChange={(checked) =>
                    update.mutate({
                      vendorId: vendor.id,
                      data: {
                        kind: vendor.kind,
                        name: vendor.name,
                        visibleToFamily: checked,
                      },
                    })
                  }
                />
                Families
              </label>

              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label={`Remove ${vendor.name}`}
                onClick={() => archive.mutate({ vendorId: vendor.id })}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({
            data: {
              kind: kind as "monument",
              name: name.trim(),
              phone: phone.trim() || null,
              postalCode: postalCode.trim() || null,
            },
          });
        }}
      >
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <Label htmlFor="vendorName">Add by hand</Label>
          <Input
            id="vendorName"
            required
            value={name}
            placeholder="Granite & Sons"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendorPhone">Phone</Label>
          <Input
            id="vendorPhone"
            type="tel"
            value={phone}
            className="w-[10rem]"
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendorZip">ZIP</Label>
          <Input
            id="vendorZip"
            value={postalCode}
            className="w-[7rem]"
            inputMode="numeric"
            onChange={(event) => setPostalCode(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={!name.trim()}>
          <Plus className="size-4" />
          Add
        </Button>
      </form>
    </div>
  );
}
