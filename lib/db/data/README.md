# Shipped reference data

## `zcta-centroids.csv.gz`

`zip,latitude,longitude` for all 33,791 US ZIP Code Tabulation Areas.

Source: US Census Bureau 2023 National ZCTA Gazetteer File. Work of the US
federal government, so public domain — it can be redistributed in this
repository without a licence.

This is what makes "within 20 miles of 80202" a real answer nationwide rather
than a string comparison on ZIP prefixes. Centroids, not boundaries: a ZIP
covering half a county is represented by its middle, which is accurate enough
to rank three monument companies by distance and not accurate enough to do
anything else with.

Load it with `pnpm --filter @workspace/scripts run load-postal-codes`.

## What is deliberately *not* shipped here

No business listings. There is no public-domain nationwide directory of
monument companies, casket and urn dealers, or clergy — those are licensed
commercial products — and inventing plausible names and phone numbers for a
product that hands them to bereaved families would be worse than shipping
nothing. Homes add their own, import from a provider they license, or connect
a places provider with their own API key.

Cemeteries are no exception, and it is worth writing down why, because the
obvious idea does not work. The USGS Geographic Names Information System used
to list every named cemetery in the country and would have been a perfect
public-domain seed. It no longer does: USGS retired the man-made structure
classes, and the current national file carries 43 feature classes — streams,
summits, valleys, reservoirs — with Cemetery not among them. An importer was
written against it, run against the real 38 MB download, and found zero rows.
The VA's national cemetery API needs credentials.

So cemeteries are added the same way as everyone else: typed in, or found
through a places provider the home connects. If a genuinely open cemetery
dataset appears, it belongs here.
