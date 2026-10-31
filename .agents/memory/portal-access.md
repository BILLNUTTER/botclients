---
name: Portal access model
description: Nutterx Connect’s public pages and administrator authentication policy.
---

The Nutterx Connect public experience has no client sign-in. Visitors see the landing page and active-client names, can select a name and verify with the registered phone number, then view the account's service and expiry information. The directory can be refreshed and fetches current data when revisiting or focusing the page. Administrators enter through `?admin=true` and authenticate with the admin key. Do not add a client login or a visible admin-dashboard link unless the user changes this requirement.

**Why:** the user explicitly requested this access model for the portal.

**How to apply:** keep admin APIs protected by the server-issued session cookie; do not expose the admin key, internal notes, or unrelated private client details in public responses.
