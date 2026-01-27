# Phia’s Fab OS – v2.2.2 ABCD (Integrated)

Includes:
A) File-type badges on product windows (tags → badges)
 B) Studio app (Text→SVG, SVG preview, Notes, Download SVG)
 C) Vault UI in-window (via /pages/vault)
D) Desktop icon file-type badge overlay

## Required Shopify step
Create a page:
- Online Store → Pages → Add page
- Title: Vault
- URL: /pages/vault  (handle must be 'vault')

## Tag system
Primary file tags:
file-svg, file-stl, file-pdf, file-plr, file-ebook, file-tutorial, file-art, file-print, file-template, file-wallpaper, file-bundle

Compatibility tags:
compat-cricut, compat-silhouette, compat-3dprint, compat-cnc, compat-canva, compat-procreate, compat-ai, compat-ps

License tags:
lic-personal, lic-commercial, lic-extended

## Security
Protected routes (/account, /checkout, /cart, etc.) always open normally (never fetched into windows).
