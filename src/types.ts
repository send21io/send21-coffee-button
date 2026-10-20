import type { Send21Currency, Send21Network } from "./currencies.js";

/** One receiving option on a pay link, exactly as POST /payment-requests takes it. */
export interface PayOption {
  currency: Send21Currency;
  network: Send21Network;
  address: string;
  method?: "Lightning";
}

export type OrderStatus =
  | "open" // 🟡 pay link created
  | "seen" // 👀 a payment is on its way
  | "review" // ⚠️ a different amount arrived; the account owner decides on send21
  | "accepted" // 👍 different amount accepted, waiting for confirmation
  | "paid" // ✅ confirmed and checked: shows on the wall
  | "declined" // ↩️ different amount declined
  | "unresolved" // ⚠️ expired while a different amount was undecided
  | "expired" // ⌛ nobody paid
  | "flagged"; // 🚩 a confirmed payment did NOT match this order (never on the wall)

export const CUPS = [1, 3, 5] as const;
export type Cups = (typeof CUPS)[number];

export interface Order {
  id: string; // the form nonce
  orderId: string; // coffee-<id>
  cups: Cups;
  fiatAmount: number;
  fiatCurrency: string;
  message: string | null;
  options: PayOption[];
  paymentRequestId: string | null;
  payUrl: string | null;
  expiresAt: string | null;
  status: OrderStatus;
  paid?: {
    currency: string;
    network: string;
    amount: string | null;
    txId: string;
    /** paymentMethod, when the webhook carries one ("Lightning"). */
    method?: string;
    differentAmount: boolean;
    at: string;
  };
  problems?: string[];
  /** Hidden from the wall by the owner (npm run wall:hide). */
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
}
