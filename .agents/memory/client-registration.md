---
name: Client registration fields
description: Nutterx Connect client registration and service data requirements.
---

Registering a client requires only name, phone number, amount paid, and a shared service selected from the catalog. Show the selected service's shared expiry as read-only; do not collect a separate per-client expiry or service type.

Each shared service plan has one expiry date for every assigned client. Amount paid remains specific to each client. Clearing all service assignments must keep both client profiles and shared service plans.

**Why:** the user requested a short registration form without service types, chose a shared service and expiry model, and asked to clear services without removing clients.

**How to apply:** select an existing plan during registration; edit its expiry on the shared plan so all assigned accounts update together. Clear only client-to-service assignments, never the client or plan records.
