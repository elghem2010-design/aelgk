# ElajX (علاجك) — Master Project Brief

**Project Name:** ElajX (علاجك)  
**Classification:** Egyptian Health-Tech Platform (Medicine Discovery, Pharmacy Fulfillment & Courier Delivery)  
**Status:** Phase 0 (Discovery & Architecture) & Phase 1 Initial Scaffold  
**Date:** October 2026  

---

## 1. Executive Summary

ElajX (علاجك) is a health-technology platform designed specifically for the Egyptian pharmaceutical and healthcare market. The platform connects Egyptian patients and customers with licensed community pharmacies and authorized delivery couriers to streamline medicine discovery, prescription fulfillment requests, clinical alternative consultation, transparent pricing, and secure last-mile delivery.

Unlike generic e-commerce marketplaces, ElajX is architected under stringent clinical, regulatory, and data privacy safeguards:
- **No Direct Drug Selling by Unlicensed Parties:** ElajX operates strictly as a coordination, discovery, and logistics orchestration platform. All medicine fulfillment, pricing confirmation, prescription verification, and dispensing are performed exclusively by licensed Egyptian pharmacies and registered pharmacists.
- **Qualified Alternative Approvals:** Automatic or unverified clinical substitutions are strictly forbidden. Any generic or therapeutic alternative proposed by a dispensing pharmacist requires qualified pharmaceutical rationale and explicit customer consent before an order can be formed.
- **Strict Role-Based Segregation:** Four discrete user roles (Customer, Pharmacy Staff, Courier, System Administrator) operate across isolated portal surfaces, governed by PostgreSQL Row-Level Security (RLS) and server-authoritative state machines.

---

## 2. Core Business Workflows

### 2.1 The 10-Step Order Lifecycle
1. **Medicine Discovery & Request Submission:** Customer searches the curated Egyptian medicine catalog or submits a prescription/medicine request with notes.
2. **Pharmacy Routing:** The platform routes the request to authorized participating pharmacies within the delivery catchment zone.
3. **Availability & Price Verification:** The licensed pharmacy verifies shelf availability, batches, and current official Egyptian Drug Authority (EDA) pricing.
4. **Alternative Formulation & Clinical Review (if needed):** If the requested brand is out of stock, the pharmacist may propose a bioequivalent alternative with identical active ingredient, strength, and dosage form.
5. **Customer Informed Consent:** The customer reviews the pharmacist's note, active ingredients, and confirmed price, explicitly accepting or declining the substitution.
6. **Order Confirmation:** Once accepted by both parties, the request transitions to a confirmed order with locked item prices and transparent delivery fees.
7. **Pharmacy Preparation:** Pharmacy packages the sealed, tamper-evident parcel with batch and dispensing reference numbers.
8. **Courier Assignment:** An authorized courier is assigned to the fulfillment batch.
9. **Chain of Custody & Delivery:** Courier verifies parcel pickup at the pharmacy and delivers it to the customer's delivery address, recording delivery proof.
10. **Audit Logging & Settlement:** Every transition is written to an immutable audit ledger accessible to administrators for regulatory inspection and issue resolution.

---

## 3. The Four Dedicated Portals

| Portal | Primary Audience | Core Responsibilities |
| :--- | :--- | :--- |
| **Customer Portal** | Patients & Families in Egypt | Arabic-first discovery, medicine requests, alternative consent, real-time tracking, order history, address book. |
| **Pharmacy Portal** | Licensed Pharmacists & Staff | Inbound request triage, stock & official price verification, alternative proposals, packing confirmation, fulfillment metrics. |
| **Courier Portal** | Authorized Delivery Couriers | Delivery queue, route navigation, pickup verification, privacy-preserving proof-of-delivery, exception logging. |
| **Admin Portal** | Compliance & Operations Staff | Pharmacy & courier vetting, catalog management, audit trail inspection, dispute investigation, role management. |

---

## 4. Egyptian Regulatory & Clinical Boundaries

1. **Catalog vs. Verified Availability:** A catalog record is solely an informational index; it does NOT constitute guaranteed stock. Stock is only confirmed when a licensed pharmacist verifies it in real-time.
2. **Prescription-Only Medicines (POM):** Cannot be dispensed without valid medical prescription review by a qualified pharmacist.
3. **Price Transparency:** Egyptian pharmaceutical pricing is regulated by the Ministry of Health & Population / Egyptian Drug Authority (EDA). The platform displays transparent pricing without hidden markups.
4. **Data Sovereignty & Health Privacy:** Patient medical requests, prescription images, and address data are restricted strictly to the fulfilling pharmacy and assigned courier on a need-to-know basis.

---

## 5. Technical Baseline

- **Frontend:** React 19 + TypeScript + Vite with RTL (Right-to-Left) Arabic layout.
- **Styling:** Tailwind CSS with a clinical health-tech palette (deep slate, clinical emerald, neutral canvas).
- **Navigation:** React Router with role-based routing guards.
- **Database & Auth Target:** PostgreSQL via Supabase with Row Level Security (RLS) policies.
- **State Integrity:** Server-authoritative transitions with immutable audit event logging.
