# ElajX (علاجك) — Architecture Specification

## 1. System Overview

ElajX is structured as a client-side single-page application (React 19 + TypeScript + Vite) connecting to a secure PostgreSQL backend via Supabase (or an Express-mediated API tier for sensitive business operations), backed by Row Level Security (RLS) and server-side authorization functions.

```
+-----------------------------------------------------------------------------------+
|                                  ElajX Client                                     |
|  (RTL Arabic-First, Modern Health-Tech UI, Multi-Portal Role Shells)             |
|                                                                                   |
|  [ Customer Portal ]  [ Pharmacy Portal ]  [ Courier Portal ]  [ Admin Portal ]   |
|         |                   |                    |                  |             |
|  +------+-------------------+--------------------+------------------+----------+  |
|  |                Shared Design System & Data Access Layer                     |  |
+--+------------------------------------------------------------------------------+-+
                                      |
                         HTTPS / WSS / REST / RPC
                                      |
+-----------------------------------------------------------------------------------+
|                        Server-Side Functions & Auth Gate                          |
|  - Token validation & Role Verification (JWT claims + DB user_roles)             |
|  - Transition State Machine (prevents illegal skips, e.g. unapproved delivery)    |
|  - Price Lock & Fee Calculation Engine                                            |
|  - Audit Log Dispatcher (immutable record of all state transitions)               |
+-----------------------------------------------------------------------------------+
                                      |
+-----------------------------------------------------------------------------------+
|                         PostgreSQL Relational Storage                             |
|  - Row Level Security (RLS) enforcing multi-tenant isolation per role            |
|  - Tables: users, pharmacies, couriers, catalog, requests, orders, audits        |
+-----------------------------------------------------------------------------------+
```

---

## 2. Entity Relational Design

The system explicitly distinguishes an uncommitted **Medicine Request** from a binding **Confirmed Order**.

```
[users] 1 --- * [user_roles]
   |
   +-- 1:1 [customer_profiles]
   +-- 1:* [customer_addresses]
   +-- 1:* [pharmacy_staff] --- * [pharmacies]
   +-- 1:1 [courier_profiles]

[medicine_catalog]
   |
   +-- 1:* [request_items] --- * [medicine_requests]
   |                                    |
   |                                1:1 or 1:*
   |                                    v
   |                              [orders] 1 --- * [order_items]
   |                                 |
   +-- 1:* [proposed_alternatives]   +-- 1:1 [delivery_assignments]
                                            |
                                            +-- 1:* [delivery_events]

[audit_logs] (Applies across all lifecycle transitions)
```

### Key Entities:
1. `users`: Core identity managed via Supabase Auth (`auth.users`), linked to application profile records.
2. `user_roles`: Trusted role assignments (`customer`, `pharmacy_staff`, `courier`, `admin`). Privileged roles can only be granted via secure admin endpoints.
3. `pharmacies`: Verified licensed entities with commercial registration, Egyptian Syndicate license, operating address, and contact details.
4. `pharmacy_staff`: Mapping between `users` and `pharmacies` with specific capabilities (`pharmacist`, `manager`, `assistant`).
5. `courier_profiles`: Verified delivery personnel with national ID validation, vehicle type, and active shift state.
6. `medicine_catalog`: Curated Egyptian drug repository containing brand names, generic active ingredients (INN), dosage forms, strengths, manufacturer, and official pricing caps.
7. `medicine_requests`: A patient's inbound inquiry for one or more medicines or alternatives.
8. `request_items`: Line items specifying requested brand/generic, quantity, and optional prescription attachment references.
9. `proposed_alternatives`: Pharmacist-submitted generic or bioequivalent recommendations, including active ingredient equivalence, rationale, and price comparison.
10. `orders`: Created ONLY when stock is verified and any alternative is explicitly customer-approved. Prices, fees, and delivery addresses are frozen upon order confirmation.
11. `order_items`: Confirmed items with locked unit prices and fulfillment source.
12. `delivery_assignments`: Links an order to an authorized courier with status tracking.
13. `delivery_events`: Append-only event history (assigned, picked_up, in_transit, arrived, completed, failed).
14. `audit_logs`: Immutable, append-only operational record tracking actor, action, target entity, timestamp, and metadata.

---

## 3. Request vs. Order Separation Rationale

A common flaw in rudimentary commerce systems is treating an initial medicine request as a finished order. In medicine fulfillment:
- Inventory fluctuates rapidly in physical community pharmacies.
- Regulated Egyptian pricing may change, or prescription requirements must be verified.
- Alternative generics may be necessary when primary brands are out of stock.

Therefore:
- A `medicine_request` represents a negotiation phase (enquiring, checking availability, proposing alternatives).
- An `order` represents an executed contract with fixed pricing, locked items, and assigned fulfillment guarantees.

---

## 4. Client-Side Portal Boundaries

The frontend application provides four distinct portal contexts:
1. `/customer/*`: Patients requesting medicines, managing delivery addresses, reviewing proposed alternatives, and tracking active deliveries.
2. `/pharmacy/*`: Pharmacists reviewing incoming requests in their geographical catchment, entering confirmed stock/prices, proposing bioequivalent alternatives, and packaging orders.
3. `/courier/*`: Delivery drivers managing assigned tasks, verifying sealed bag pickups, routing to customer addresses, and recording deliveries.
4. `/admin/*`: Operations team verifying pharmacies and couriers, monitoring system throughput, maintaining the drug catalog, and inspecting audit trails.

A shared layout switcher and role badge allow authenticated users or demo evaluators to switch views in preview while enforcing role contracts when connected to live backend databases.
