# Request to NovaMira — Catalog / Datasheet button on ubio.ae products

## What we want

A "Catalog Download" button on every WooCommerce product page on
**www.ubio.ae**, in the style of the manufacturer's own page
(unionbiometrics.com/en/portfolio/ac-5100 — blue rounded pill button under the
product intro). wacomme.ae already has this button; ubio.ae does not.

## Where the button gets its link

Read one product meta key. Do not hard-code URLs in the template.

| meta key                      | value                                  | required |
|-------------------------------|----------------------------------------|----------|
| `deepinsights_datasheet_url`  | full URL to the PDF                    | yes      |
| `deepinsights_datasheet_label`| button text, default "Catalog Download"| no       |

Deep Insights will write these keys through the WooCommerce REST API
(`meta_data`, same route Rank Math fields use). Until then we fill them by hand
in the product's Custom Fields box, so the key must be a normal (not
underscore-prefixed) meta key that WordPress shows there.

## Behaviour

- If `deepinsights_datasheet_url` is empty, render nothing. No empty button,
  no wrapper.
- Opens the PDF in a new tab for preview (`target="_blank"`,
  `rel="noopener"`). Do **not** add the `download` attribute — wacomme.ae
  currently forces a download; preview is wanted on ubio.ae.
- Placement: in the product summary, directly under the short description and
  above the category line. Same spot on mobile.
- Add it to the shared product template, so every existing and future product
  gets it. No per-product Elementor edits.
- `aria-label="Open catalog (PDF)"`. Show the file size after the label if
  cheap to compute; skip it otherwise.
- Style to match the site's primary button. Reference image: the blue
  "Catalog Download" pill on the Union Biometrics page.

## For wacomme.ae

The existing datasheet button (`nv-ds-btn`) should read the same
`deepinsights_datasheet_url` key, falling back to whatever it reads today. Then
one field works on both sites.

## Acceptance

1. Product with the key set → button shows, opens PDF in a new tab.
2. Product without the key → nothing rendered.
3. Works on the existing shared template; no product was edited individually.
4. Tell us the shortcode or widget name used, for our records.

Contact: walid@etopme.ae
