// Hide (or show again) one supporter note on the wall. It still counts as a coffee.
//   npm run wall:hide -- <order id or coffee-<id>>          hide
//   npm run wall:hide -- <order id> --show                   show again
//   npm run wall:hide -- --list                              list paid notes
// Stop the server first: one process owns the JSON file, a running server would overwrite this change.
import "dotenv/config";
import { Store } from "../src/store.js";

const args = process.argv.slice(2);
const store = new Store(process.env.DATA_FILE?.trim() || "./data/coffee.json");

if (args.includes("--list") || args.length === 0) {
  for (const o of store.orders().filter((o) => o.status === "paid")) console.log(`${o.hidden ? "🙈" : "👁️ "} ${o.id}  ☕×${o.cups}  ${o.message ?? ""}`);
  process.exit(0);
}
const id = args.find((a) => !a.startsWith("--"))!.replace(/^coffee-/, "");
const show = args.includes("--show");
const ok = store.transaction((d) => {
  const o = d.orders[id];
  if (!o) return false;
  d.orders[id] = { ...o, hidden: !show, updatedAt: new Date().toISOString() };
  return true;
});
console.log(ok ? `${show ? "👁️ shown" : "🙈 hidden"}: ${id}` : `no order ${id}`);
process.exit(ok ? 0 : 1);
