// Hardcoded enum-value sets used by both API routes and UI. We do NOT
// import Object.values(SupportThreadStatus) at module scope — that
// pattern breaks Next 15's build-time page-data collector when Prisma's
// runtime enum resolves to undefined during compilation. Keep this list
// in sync with the enums in schema.prisma.

export const SUPPORT_THREAD_STATUSES = [
  "OPEN",
  "WAITING_MERCHANT",
  "WAITING_SUPPLIER",
  "WAITING_ADMIN",
  "RESOLVED",
  "CLOSED",
] as const;

export type SupportThreadStatusValue = (typeof SUPPORT_THREAD_STATUSES)[number];

export const SUPPORT_PARTY_TYPES = [
  "ADMIN",
  "MERCHANT",
  "SUPPLIER",
  "SYSTEM",
] as const;

export type SupportPartyTypeValue = (typeof SUPPORT_PARTY_TYPES)[number];

export const SUPPORT_ENTITY_TYPES = [
  "MERCHANT_APPLICATION",
  "PURCHASE_ORDER",
  "TRANSACTION",
] as const;

export type SupportEntityTypeValue = (typeof SUPPORT_ENTITY_TYPES)[number];

// Human-readable status labels used in the admin filter tabs and thread
// header. Kept alongside the enum values so a status rename here touches
// one file, not five.
export const SUPPORT_STATUS_LABELS: Record<SupportThreadStatusValue, string> = {
  OPEN: "Open",
  WAITING_MERCHANT: "Waiting on merchant",
  WAITING_SUPPLIER: "Waiting on supplier",
  WAITING_ADMIN: "Waiting on us",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

// The three roles that can access support chat on the admin side. Kept
// as a Set for O(1) membership check inside the RBAC helper. SUPER_ADMIN
// is always on the list; SUPPORT is the primary user of this surface.
export const SUPPORT_ROLES = new Set<string>(["SUPER_ADMIN", "SUPPORT"]);
