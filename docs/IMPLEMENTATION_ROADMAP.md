# ElajX (علاجك) — Implementation Roadmap

This roadmap governs the stepwise evolution of the ElajX platform. Each phase has clear entrance and exit criteria, testing gates, and regulatory boundaries.

---

## Phase 0: Discovery & Architecture (CURRENT)
- [x] Inspect initial repository setup, dependencies, and environment constraints.
- [x] Author core documentation suite:
  - `docs/PROJECT_BRIEF.md`
  - `docs/ARCHITECTURE.md`
  - `docs/SECURITY_MODEL.md`
  - `docs/ORDER_LIFECYCLE.md`
  - `docs/IMPLEMENTATION_ROADMAP.md`
- [x] Define data entities, state machine transitions, and RLS policies.
- [x] Record unresolved decisions, assumptions, and owner requirements.

---

## Phase 1: Secure Foundation (CURRENT IN-PROGRESS)
- [x] Author Arabic-first RTL design foundation with clinical health-tech design system.
- [x] Install maintained routing infrastructure (`react-router-dom`).
- [x] Establish four distinct portal shells:
  - **Customer Portal:** Discovery, request form, alternative consent dialog, active tracking shell.
  - **Pharmacy Portal:** Review queue, stock/pricing confirmation modal, alternative proposal drawer.
  - **Courier Portal:** Assigned pickups, route overview, privacy-preserving proof-of-delivery mock.
  - **Admin Portal:** Pharmacy/courier verification status, catalog overview, audit log viewer.
- [x] Prepare typed interfaces (`src/types/index.ts`) matching database entities.
- [x] Create version-controlled SQL migration script (`supabase/migrations/20261019000001_initial_schema.sql`).
- [x] Safe `.env.example` with exact required variables and no secrets.
- [x] Verified build (`npm run build`) and linting (`npm run lint`).

---

## Phase 2: Authentication & Database Provisioning
- [ ] Connect Supabase PostgreSQL database once credentials are provided by project owner.
- [ ] Execute `20261019000001_initial_schema.sql` to establish tables, constraints, and indexes.
- [ ] Implement Supabase Auth (Email + OTP for Egypt phone numbers `+20`).
- [ ] Setup `user_roles` trigger and custom JWT claims hook for role-based authorization.
- [ ] Apply and test Row Level Security (RLS) policies with negative testing (e.g. customer cannot access pharmacy queue).

---

## Phase 3: Medicine Discovery & Pharmacy Verification
- [ ] Seed verified Egyptian Drug Authority (EDA) catalog baseline (generic INN names, brands, dosages).
- [ ] Client-side search and filtering (brand name, active substance, dosage form, manufacturer).
- [ ] Pharmacy onboarding application workflow (commercial record, syndicate license number).
- [ ] Pharmacy verification admin approval workflow.
- [ ] Pharmacy stock observation and price verification interface.

---

## Phase 4: Request & Order Workflow
- [ ] Customer medicine request submission (prescription upload + OTC item selection).
- [ ] Pharmacy proposal flow: direct confirmation vs bioequivalent alternative proposal.
- [ ] Customer explicit consent flow for proposed alternatives.
- [ ] Server-enforced order creation, price lock, and delivery fee calculation.
- [ ] Tamper-evident packaging confirmation by pharmacy.

---

## Phase 5: Courier Operations & Delivery
- [ ] Courier onboarding and verification workflow.
- [ ] Geographical batch assignment to available authorized couriers.
- [ ] Pharmacy pickup verification (barcode / batch number match).
- [ ] Delivery status update and safe customer contact (masked proxy/direct call).
- [ ] Privacy-preserving Proof-of-Delivery (OTP verification or recipient signature).
- [ ] Delivery exception and failure reporting workflow.

---

## Phase 6: Administration & Operational Readiness
- [ ] Administrative oversight dashboard with real-time operational indicators.
- [ ] Immutable audit log explorer with filtering by actor, action, and order.
- [ ] Disputed order investigation and manual resolution tools.
- [ ] Database backup and retention policy documentation.
- [ ] Performance monitoring and error tracing setup.

---

## Phase 7: Security & Launch Review
- [ ] Comprehensive penetration review:
  - IDOR / BOLA tests on request and order endpoints.
  - Role escalation prevention.
  - SQL injection and RLS bypass verification.
  - Race condition prevention on order confirmation.
- [ ] Compliance sign-off with Egyptian pharmaceutical dispensing regulations.
- [ ] Disaster recovery and rollback runbooks.
- [ ] Production deployment on hardened infrastructure.
