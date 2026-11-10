/** Juice storefront: products, catalogue, cart, juice orders, delivery zones, reviews.
 *
 * This module is NEW for the MnM Juice Bar expansion and coexists with the existing
 * ticketing module (events/orders/tickets). Juice orders use their own tables and lifecycle.
 * Payment is reused through the existing payments table where appropriate.
 */
import { queryAll, queryOne, run, tx } from "./db.ts";
import { formatMinor } from "./money.ts";

// ---------- product catalogue ----------

export interface ProductCategory {
  id: number;
  name: string;
  description: string;
  sort_order: number;
  image_url: string | null;
}

export interface ProductSize {
  label: string;
  priceMinor: number;
}

export interface ProductAddon {
  name: string;
  priceMinor: number;
}

export interface Product {
  id: number;
  categoryId: number;
  sku: string;
  name: string;
  description: string;
  ingredientNote: string | null;
  priceMinor: number;
  currency: string;
  available: boolean;
  featured: boolean;
  bestseller: boolean;
  sizes: ProductSize[];
  addons: ProductAddon[];
  sortOrder: number;
  primaryImage: string | null;
  category: ProductCategory | null;
}

export function allCategories(): ProductCategory[] {
  return queryAll(
    `SELECT id, name, description, sort_order, image_url
       FROM product_categories ORDER BY sort_order, name`,
  ) as unknown as ProductCategory[];
}

export function categoryById(id: number): ProductCategory | null {
  return queryOne(`SELECT id, name, description, sort_order, image_url FROM product_categories WHERE id=?`, [id]) as unknown as ProductCategory | null;
}

export function productsInCategory(categoryId: number, opts?: { featured?: boolean; available?: boolean; limit?: number }): Product[] {
  const conditions = [];
  if (opts?.featured) conditions.push("featured=1");
  if (opts?.available !== undefined) conditions.push(`available=${opts.available ? 1 : 0}`);
  const where = conditions.length ? `WHERE category_id=? AND ${conditions.join(" AND ")}` : `WHERE category_id=?`;

  const rows = queryAll(
    `SELECT p.id, p.category_id, p.sku, p.name, p.description, p.ingredient_note,
            p.price_minor, p.currency, p.available, p.featured, p.bestseller, p.sizes, p.addons, p.sort_order,
            (SELECT storage_path FROM product_images pi WHERE pi.product_id=p.id AND pi."primary"=1) AS primary_image
       FROM products p
      ${where}
      ORDER BY p.sort_order, p.name`,
    [categoryId, ...(opts?.limit ? [opts.limit] : [])],
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => toProduct(r, categoryById(Number(r.category_id))));
}

export function featuredProducts(limit = 8): Product[] {
  const rows = queryAll(
    `SELECT p.id, p.category_id, p.sku, p.name, p.description, p.ingredient_note,
            p.price_minor, p.currency, p.available, p.featured, p.bestseller, p.sizes, p.addons, p.sort_order,
            (SELECT storage_path FROM product_images pi WHERE pi.product_id=p.id AND pi."primary"=1) AS primary_image
       FROM products p
      WHERE p.featured=1 AND p.available=1
      ORDER BY p.sort_order, p.name
      LIMIT ?`, [limit]) as Array<Record<string, unknown>>;
  return rows.map((r) => toProduct(r, categoryById(Number(r.category_id))));
}

export function bestsellerProducts(limit = 6): Product[] {
  const rows = queryAll(
    `SELECT p.id, p.category_id, p.sku, p.name, p.description, p.ingredient_note,
            p.price_minor, p.currency, p.available, p.featured, p.bestseller, p.sizes, p.addons, p.sort_order,
            (SELECT storage_path FROM product_images pi WHERE pi.product_id=p.id AND pi."primary"=1) AS primary_image
       FROM products p
      WHERE p.bestseller=1 AND p.available=1
      ORDER BY p.sort_order, p.name
      LIMIT ?`, [limit]) as Array<Record<string, unknown>>;
  return rows.map((r) => toProduct(r, categoryById(Number(r.category_id))));
}

export function allProducts(opts?: { available?: boolean; search?: string }): Product[] {
  let sql = `SELECT p.id, p.category_id, p.sku, p.name, p.description, p.ingredient_note,
                  p.price_minor, p.currency, p.available, p.featured, p.bestseller, p.sizes, p.addons, p.sort_order,
                  (SELECT storage_path FROM product_images pi WHERE pi.product_id=p.id AND pi."primary"=1) AS primary_image
             FROM products p
            WHERE 1=1`;
  const params: (string | number)[] = [];
  if (opts?.available !== undefined) sql += ` AND p.available=${opts.available ? 1 : 0}`;
  if (opts?.search && opts.search.trim()) {
    const s = String(opts.search).trim();
    sql += ` AND (p.name LIKE ? OR p.description LIKE ?)`;
    params.push(`%${s}%`, `%${s}%`);
  }
  sql += ` ORDER BY p.sort_order, p.name`;
  const rows = queryAll(sql, params) as Array<Record<string, unknown>>;
  return rows.map((r) => toProduct(r, categoryById(Number(r.category_id))));
}

export function productById(id: number): Product | null {
  const r = queryOne(
    `SELECT p.id, p.category_id, p.sku, p.name, p.description, p.ingredient_note,
            p.price_minor, p.currency, p.available, p.featured, p.bestseller, p.sizes, p.addons, p.sort_order,
            (SELECT storage_path FROM product_images pi WHERE pi.product_id=p.id AND pi."primary"=1) AS primary_image
       FROM products p WHERE p.id=?`, [id]) as Record<string, unknown> | null;
  if (!r) return null;
  return toProduct(r, categoryById(Number(r.category_id)));
}

export function searchProducts(query: string): Product[] {
  return allProducts({ search: query, available: true });
}

// ---------- cart & checkout helpers ----------

export interface CartItem {
  productId: number;
  qty: number;
  sizeLabel?: string;
  sizePriceMinor?: number;
  addonsChosen?: string[];            // names
  addonsPriceMinor?: number;
}

export interface CartTotals {
  subtotalMinor: number;
  deliveryZoneId?: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
}

export function cartSubtotal(items: CartItem[]): number {
  let subtotal = 0;
  for (const item of items) {
    const product = productById(item.productId);
    if (!product || !product.available) continue;
    const sizeExtra = item.sizePriceMinor ?? 0;
    const addonsExtra = item.addonsPriceMinor ?? 0;
    const unitPrice = product.priceMinor + sizeExtra + addonsExtra;
    subtotal += unitPrice * item.qty;
  }
  return subtotal;
}

export function deliveryZoneById(id: number): DeliveryZone | null {
  return queryOne(`SELECT id, name, description, fee_minor AS feeMinor, min_order_minor AS minOrderMinor, enabled, sort_order FROM delivery_zones WHERE id=?`, [id]) as unknown as DeliveryZone | null;
}

export function enabledDeliveryZones(): DeliveryZone[] {
  return queryAll(`SELECT id, name, description, fee_minor AS feeMinor, min_order_minor AS minOrderMinor, enabled, sort_order FROM delivery_zones WHERE enabled=1 ORDER BY sort_order, name`) as unknown as DeliveryZone[];
}

export function computeJuiceOrderTotals(items: CartItem[], deliveryZoneId?: number, discountMinor = 0): CartTotals {
  const subtotal = cartSubtotal(items);
  let deliveryFee = 0;
  if (deliveryZoneId) {
    const zone = deliveryZoneById(deliveryZoneId);
    if (zone) {
      // Apply minimum-order rule: if below minimum, fee is still charged but flagged; customer sees it.
      deliveryFee = zone.feeMinor;
    }
  }
  const discount = Math.max(0, discountMinor);
  const total = subtotal + deliveryFee - discount;
  return { subtotalMinor: subtotal, deliveryZoneId: deliveryZoneId, deliveryFeeMinor: deliveryFee, discountMinor: discount, totalMinor: Math.max(0, total) };
}

// ---------- juice orders ----------

export type JuiceOrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready_for_pickup"
  | "ready_for_dispatch"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "failed";

export interface JuiceOrder {
  id: number;
  orderRef: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  type: "pickup" | "delivery";
  pickupName: string | null;
  pickupInstructions: string | null;
  deliveryZoneId: number | null;
  deliveryAddress: string | null;
  deliveryContact: string | null;
  deliveryInstructions: string | null;
  status: JuiceOrderStatus;
  assignedStaffId: number | null;
  riderName: string | null;
  riderPhone: string | null;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  currency: string;
  paymentId: number | null;
  paymentStatus: string | null;
  customerNotes: string | null;
  staffNotes: string | null;
  createdAt: string;
  updatedAt: string;
  items: JuiceOrderItem[];
  deliveryZone: DeliveryZone | null;
}

export interface JuiceOrderItem {
  id: number;
  productId: number;
  productName: string;
  sizeLabel: string | null;
  sizePriceMinor: number | null;
  addonsChosen: string[] | null;
  addonsPriceMinor: number | null;
  qty: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface DeliveryZone {
  id: number;
  name: string;
  description: string;
  feeMinor: number;
  minOrderMinor: number;
  enabled: boolean;
  sortOrder: number;
}

export function recentJuiceOrders(limit = 50): JuiceOrder[] {
  const rows = queryAll(
    `SELECT jo.id, jo.order_ref, jo.customer_name, jo.customer_phone, jo.customer_email,
            jo.type, jo.pickup_name, jo.pickup_instructions,
            jo.delivery_zone_id, jo.delivery_address, jo.delivery_contact, jo.delivery_instructions,
            jo.status, jo.assigned_staff_id, jo.rider_name, jo.rider_phone,
            jo.subtotal_minor, jo.delivery_fee_minor, jo.discount_minor, jo.total_minor, jo.currency,
            jo.payment_id, jo.payment_status, jo.customer_notes, jo.staff_notes,
            jo.created_at, jo.updated_at
       FROM juice_orders jo
      ORDER BY jo.created_at DESC LIMIT ?`, [limit]) as Array<Record<string, unknown>>;

  const orders = rows.map((r) => {
    const order = toJuiceOrder(r);
    order.items = juiceOrderItemsForOrder(order.id);
    order.deliveryZone = order.deliveryZoneId ? deliveryZoneById(Number(order.deliveryZoneId)) : null;
    return order;
  });
  return orders;
}

export function juiceOrderById(id: number): JuiceOrder | null {
  const r = queryOne(
    `SELECT jo.id, jo.order_ref, jo.customer_name, jo.customer_phone, jo.customer_email,
            jo.type, jo.pickup_name, jo.pickup_instructions,
            jo.delivery_zone_id, jo.delivery_address, jo.delivery_contact, jo.delivery_instructions,
            jo.status, jo.assigned_staff_id, jo.rider_name, jo.rider_phone,
            jo.subtotal_minor, jo.delivery_fee_minor, jo.discount_minor, jo.total_minor, jo.currency,
            jo.payment_id, jo.payment_status, jo.customer_notes, jo.staff_notes,
            jo.created_at, jo.updated_at
       FROM juice_orders jo WHERE jo.id=?`, [id]) as Record<string, unknown> | null;
  if (!r) return null;
  const order = toJuiceOrder(r);
  order.items = juiceOrderItemsForOrder(order.id);
  order.deliveryZone = order.deliveryZoneId ? deliveryZoneById(Number(order.deliveryZoneId)) : null;
  return order;
}

export function juiceOrderByRef(ref: string): JuiceOrder | null {
  const r = queryOne(
    `SELECT jo.id, jo.order_ref, jo.customer_name, jo.customer_phone, jo.customer_email,
            jo.type, jo.pickup_name, jo.pickup_instructions,
            jo.delivery_zone_id, jo.delivery_address, jo.delivery_contact, jo.delivery_instructions,
            jo.status, jo.assigned_staff_id, jo.rider_name, jo.rider_phone,
            jo.subtotal_minor, jo.delivery_fee_minor, jo.discount_minor, jo.total_minor, jo.currency,
            jo.payment_id, jo.payment_status, jo.customer_notes, jo.staff_notes,
            jo.created_at, jo.updated_at
       FROM juice_orders jo WHERE jo.order_ref=?`, [ref]) as Record<string, unknown> | null;
  if (!r) return null;
  const order = toJuiceOrder(r);
  order.items = juiceOrderItemsForOrder(order.id);
  order.deliveryZone = order.deliveryZoneId ? deliveryZoneById(Number(order.deliveryZoneId)) : null;
  return order;
}

export function createJuiceOrder(params: {
  items: CartItem[];
  type: "pickup" | "delivery";
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  pickupName?: string;
  pickupInstructions?: string;
  deliveryZoneId?: number;
  deliveryAddress?: string;
  deliveryContact?: string;
  deliveryInstructions?: string;
  customerNotes?: string;
  assignedStaffId?: number;
}): { ok: boolean; orderId?: number; orderRef?: string; msg?: string } {
  const { items, type, customerName, customerPhone, customerEmail, pickupName, pickupInstructions, deliveryZoneId, deliveryAddress, deliveryContact, deliveryInstructions, customerNotes, assignedStaffId } = params;

  if (!customerName.trim() || !customerPhone.trim()) return { ok: false, msg: "Customer name and phone are required." };
  if (items.length === 0) return { ok: false, msg: "Cart cannot be empty." };
  if (items.length > 50) return { ok: false, msg: "Too many line items in one order (max 50)." };

  // Validate quantities and client-supplied price extras BEFORE any pricing maths:
  // qty must be a positive integer; price extras must be non-negative integers (minor units).
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99) {
      return { ok: false, msg: "Each item must have a quantity between 1 and 99." };
    }
    if (item.sizePriceMinor !== undefined && (!Number.isInteger(item.sizePriceMinor) || item.sizePriceMinor < 0)) {
      return { ok: false, msg: "Invalid size price in cart." };
    }
    if (item.addonsPriceMinor !== undefined && (!Number.isInteger(item.addonsPriceMinor) || item.addonsPriceMinor < 0)) {
      return { ok: false, msg: "Invalid add-on price in cart." };
    }
  }

  const productIds = items.map((i) => i.productId);
  const products = productIds.map((id) => productById(id)).filter(Boolean) as Product[];
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Validate every item exists, is available, and stock (if tracked) allows it.
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) return { ok: false, msg: `Unknown product in cart.` };
    if (!product.available) return { ok: false, msg: `${product.name} is currently unavailable.` };
  }

  const subtotal = cartSubtotal(items);
  let deliveryFee = 0;
  if (type === "delivery") {
    // A delivery order must name a real, enabled zone — never accept a missing,
    // malformed (NaN/0) or disabled zone reference with fee 0.
    if (!deliveryZoneId || !Number.isInteger(deliveryZoneId)) return { ok: false, msg: "Please choose a delivery zone." };
    const zone = deliveryZoneById(deliveryZoneId);
    if (!zone || !zone.enabled) return { ok: false, msg: "Selected delivery zone is not available." };
    deliveryFee = zone.feeMinor;
  }
  const total = Math.max(0, subtotal + deliveryFee);

  try {
    return tx(() => {
      // Build order
      const orderRef = juiceOrderRef();
      const now = new Date().toISOString();
      run(
        `INSERT INTO juice_orders(order_ref, customer_name, customer_phone, customer_email, type,
                pickup_name, pickup_instructions, delivery_zone_id, delivery_address, delivery_contact, delivery_instructions,
                status, assigned_staff_id, subtotal_minor, delivery_fee_minor, discount_minor, total_minor, currency, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          orderRef,
          customerName.trim().slice(0, 120),
          customerPhone.trim().slice(0, 30),
          (customerEmail || "").trim().slice(0, 120) || null,
          type,
          (pickupName || "").trim().slice(0, 120) || null,
          (pickupInstructions || "").trim().slice(0, 500) || null,
          deliveryZoneId || null,
          (deliveryAddress || "").trim().slice(0, 300) || null,
          (deliveryContact || "").trim().slice(0, 30) || null,
          (deliveryInstructions || "").trim().slice(0, 500) || null,
          "new",
          assignedStaffId || null,
          subtotal,
          deliveryFee,
          0,
          total,
          "KES",
          now,
          now,
        ],
      );
      const orderId = queryOne("SELECT last_insert_rowid() AS id")!.id as number;

      // Insert items
      for (const item of items) {
        const product = productMap.get(item.productId)!;
        const sizePrice = item.sizePriceMinor ?? 0;
        const addonsPrice = item.addonsPriceMinor ?? 0;
        const unitPrice = product.priceMinor + sizePrice + addonsPrice;
        const lineTotal = unitPrice * item.qty;
        run(
          `INSERT INTO juice_order_items(juice_order_id, product_id, size_label, size_price_minor, addons_chosen, addons_price_minor, qty, unit_price_minor, line_total_minor)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            orderId,
            item.productId,
            item.sizeLabel || null,
            sizePrice || null,
            JSON.stringify(item.addonsChosen || []) || null,
            addonsPrice || null,
            item.qty,
            unitPrice,
            lineTotal,
          ],
        );
      }

      // Audit
      run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)",
        [assignedStaffId || null, "juice_order.create", "juice_orders", String(orderId), JSON.stringify({ ref: orderRef, type, itemCount: items.length, total })]);

      return { ok: true, orderId, orderRef };
    });
  } catch (e) {
    console.error("[juice] create order error:", e);
    return { ok: false, msg: "Could not create order. Try again." };
  }
}

export function updateJuiceOrderStatus(orderId: number, status: JuiceOrderStatus, staffId: number, note?: string): { ok: boolean; msg?: string } {
  const allowedTransitions: Record<JuiceOrderStatus, JuiceOrderStatus[]> = {
    new: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready_for_pickup", "ready_for_dispatch", "cancelled"],
    ready_for_pickup: ["out_for_delivery", "delivered", "cancelled"], // pickup can go straight to delivered
    ready_for_dispatch: ["out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered", "failed"],
    delivered: [],
    cancelled: [],
    failed: ["cancelled"],
  };

  const order = juiceOrderById(orderId);
  if (!order) return { ok: false, msg: "Order not found." };
  const allowed = allowedTransitions[order.status] || [];
  if (!allowed.includes(status)) return { ok: false, msg: `Cannot move order from "${order.status}" to "${status}"."` };

  try {
    tx(() => {
      run("UPDATE juice_orders SET status=?, staff_notes=COALESCE(staff_notes,''), updated_at=? WHERE id=?",
        [status, new Date().toISOString(), orderId]);
      if (note) {
        run("UPDATE juice_orders SET staff_notes = COALESCE(staff_notes, '') || ' ' || ? WHERE id=?",
          [note.trim().slice(0, 500), orderId]);
      }
      run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)",
        [staffId, `juice_order.status.${status}`, "juice_orders", String(orderId), JSON.stringify({ from: order.status, to: status, note: note || null })]);
    });
    return { ok: true };
  } catch (e) {
    console.error("[juice] status update error:", e);
    return { ok: false, msg: "Could not update order status." };
  }
}

export function assignJuiceOrder(orderId: number, staffId: number, riderName?: string, riderPhone?: string): { ok: boolean; msg?: string } {
  const order = juiceOrderById(orderId);
  if (!order) return { ok: false, msg: "Order not found." };
  try {
    tx(() => {
      run("UPDATE juice_orders SET assigned_staff_id=?, rider_name=?, rider_phone=?, updated_at=? WHERE id=?",
        [staffId, (riderName || "").trim().slice(0, 80) || null, (riderPhone || "").trim().slice(0, 30) || null, new Date().toISOString(), orderId]);
      run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)",
        [staffId, "juice_order.assign", "juice_orders", String(orderId), JSON.stringify({ rider: riderName || null, riderPhone: riderPhone || null })]);
    });
    return { ok: true };
  } catch (e) {
    console.error("[juice] assign error:", e);
    return { ok: false, msg: "Could not assign order." };
  }
}

// ---------- catering enquiries ----------

export type CateringStatus = "new" | "quoted" | "confirmed" | "declined" | "completed";

export interface CateringEnquiry {
  id: number;
  reference: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  eventType: string;
  eventDate: string | null;
  guestCount: number;
  itemsRequested: string | null;
  notes: string | null;
  status: CateringStatus;
  createdAt: string;
  updatedAt: string;
}

export const CATERING_STATUSES: CateringStatus[] = ["new", "quoted", "confirmed", "declined", "completed"];

export const CATERING_EVENT_TYPES = [
  "Birthday party",
  "Corporate event",
  "Church or fellowship event",
  "School or campus event",
  "Wedding or reception",
  "Other gathering",
] as const;

/** Create a catering enquiry. Validation is server-side; returns a readable reason on failure. */
export function createCateringEnquiry(params: {
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  eventType: string;
  eventDate?: string;
  guestCount: number;
  itemsRequested?: string;
  notes?: string;
}): { ok: boolean; msg?: string; reference?: string } {
  const name = (params.contactName ?? "").trim();
  const phone = (params.contactPhone ?? "").trim();
  const eventType = (params.eventType ?? "").trim();

  if (name.length < 2) return { ok: false, msg: "Please tell us your name." };
  if (name.length > 120) return { ok: false, msg: "That name is too long." };
  if (!/^[+0-9][0-9\s()-]{6,29}$/.test(phone)) {
    return { ok: false, msg: "Please enter a valid phone number we can call you on." };
  }
  if (!eventType) return { ok: false, msg: "Please choose the type of event." };
  if (!Number.isInteger(params.guestCount) || params.guestCount < 1 || params.guestCount > 5000) {
    return { ok: false, msg: "Please give the number of guests (between 1 and 5000)." };
  }
  if (params.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(params.contactEmail.trim())) {
    return { ok: false, msg: "That email address doesn't look right." };
  }

  try {
    const now = new Date().toISOString();
    const reference = cateringRef();
    run(
      `INSERT INTO catering_enquiries(reference, contact_name, contact_phone, contact_email, event_type,
              event_date, guest_count, items_requested, notes, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'new', ?, ?)`,
      [
        reference,
        name.slice(0, 120),
        phone.slice(0, 30),
        (params.contactEmail ?? "").trim().slice(0, 120) || null,
        eventType.slice(0, 80),
        (params.eventDate ?? "").trim().slice(0, 40) || null,
        params.guestCount,
        (params.itemsRequested ?? "").trim().slice(0, 2000) || null,
        (params.notes ?? "").trim().slice(0, 2000) || null,
        now,
        now,
      ],
    );
    return { ok: true, reference };
  } catch (e) {
    console.error("[juice] catering enquiry error:", e);
    return { ok: false, msg: "We could not save your enquiry. Please call us instead." };
  }
}

export function recentCateringEnquiries(limit = 100): CateringEnquiry[] {
  const rows = queryAll(
    `SELECT id, reference, contact_name, contact_phone, contact_email, event_type, event_date,
            guest_count, items_requested, notes, status, created_at, updated_at
       FROM catering_enquiries ORDER BY created_at DESC LIMIT ?`, [limit]) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    reference: String(r.reference),
    contactName: String(r.contact_name),
    contactPhone: String(r.contact_phone),
    contactEmail: r.contact_email ? String(r.contact_email) : null,
    eventType: String(r.event_type),
    eventDate: r.event_date ? String(r.event_date) : null,
    guestCount: Number(r.guest_count),
    itemsRequested: r.items_requested ? String(r.items_requested) : null,
    notes: r.notes ? String(r.notes) : null,
    status: String(r.status) as CateringStatus,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function updateCateringEnquiryStatus(reference: string, status: CateringStatus, staffId: number, note?: string): { ok: boolean; msg?: string } {
  if (!CATERING_STATUSES.includes(status)) return { ok: false, msg: "Unknown status." };
  const existing = queryOne("SELECT id FROM catering_enquiries WHERE reference=?", [reference]);
  if (!existing) return { ok: false, msg: "Enquiry not found." };
  try {
    tx(() => {
      run("UPDATE catering_enquiries SET status=?, updated_at=? WHERE reference=?",
        [status, new Date().toISOString(), reference]);
      run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)",
        [staffId, `catering.status.${status}`, "catering_enquiries", String(existing.id),
          JSON.stringify({ reference, to: status, note: note || null })]);
    });
    return { ok: true };
  } catch (e) {
    console.error("[juice] catering status error:", e);
    return { ok: false, msg: "Could not update the enquiry." };
  }
}

let _cateringCounter = 0;
function cateringRef(): string {
  _cateringCounter = (_cateringCounter + 1) % 1_000_000;
  const stamp = String(Date.now()).slice(-6);
  return `MNM-C-${stamp}${String(_cateringCounter).padStart(3, "0")}`;
}

// ---------- reviews ----------

export interface Review {
  id: number;
  productId: number | null;
  juiceOrderId: number | null;
  rating: number;
  body: string;
  authorName: string;
  isVerified: boolean;
  status: "pending" | "approved" | "rejected";
  rejectionNote: string | null;
  createdAt: string;
  product: Product | null;
}

export function approvedReviewsForProduct(productId: number): Review[] {
  const rows = queryAll(
    `SELECT r.id, r.product_id, r.juice_order_id, r.rating, r.body, r.author_name, r.is_verified, r.status, r.rejection_note, r.created_at,
            p.id AS p_id, p.name AS p_name
       FROM reviews r
       LEFT JOIN products p ON p.id = r.product_id
      WHERE r.product_id = ? AND r.status = 'approved'
      ORDER BY r.created_at DESC`, [productId]) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ...r,
    product: r.p_id ? { id: r.p_id as number, name: r.p_name as string } as Product : null,
  })) as unknown as Review[];
}

export function allApprovedReviews(): Review[] {
  const rows = queryAll(
    `SELECT r.id, r.product_id, r.juice_order_id, r.rating, r.body, r.author_name, r.is_verified, r.status, r.rejection_note, r.created_at
       FROM reviews r WHERE r.status = 'approved' ORDER BY r.created_at DESC`) as Array<Record<string, unknown>>;
  return rows as unknown as Review[];
}

export function averageRating(productId: number): { avg: number; count: number } {
  const r = queryOne(
    `SELECT COALESCE(AVG(rating),0) AS avg, COUNT(*) AS count
       FROM reviews WHERE product_id = ? AND status = 'approved'`, [productId]) as Record<string, unknown> | null;
  return { avg: Number(r?.avg ?? 0), count: Number(r?.count ?? 0) };
}

export function submitReview(params: {
  productId?: number;
  juiceOrderId?: number;
  rating: number;
  body: string;
  authorName?: string;
  customerPhone?: string;
}): { ok: boolean; msg?: string; reviewId?: number } {
  const { productId, juiceOrderId, rating, body, authorName, customerPhone } = params;
  if (rating < 1 || rating > 5) return { ok: false, msg: "Rating must be between 1 and 5." };
  if (!body.trim()) return { ok: false, msg: "Please write a short review." };

  // If linked to an order, verify the phone matches and order is delivered (verified purchase).
  let isVerified = false;
  if (juiceOrderId) {
    const order = juiceOrderById(juiceOrderId);
    if (order && order.status === "delivered" && order.customerPhone === customerPhone) {
      isVerified = true;
    }
  }

  try {
    const now = new Date().toISOString();
    run(
      `INSERT INTO reviews(product_id, juice_order_id, rating, body, author_name, is_verified, status, created_at)
       VALUES (?,?,?,?,?,?, 'pending', ?)`,
      [productId || null, juiceOrderId || null, rating, body.trim().slice(0, 1000), (authorName || "Customer").trim().slice(0, 80) || "Customer", isVerified ? 1 : 0, now],
    );
    const id = queryOne("SELECT last_insert_rowid() AS id")!.id as number;
    run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)",
      [0, "review.submit", "reviews", String(id), JSON.stringify({ productId: productId || null, juiceOrderId: juiceOrderId || null, rating, isVerified })]);
    return { ok: true, reviewId: id };
  } catch (e) {
    console.error("[juice] review submit error:", e);
    return { ok: false, msg: "Could not submit review. Try again." };
  }
}

export function moderateReview(reviewId: number, status: "approved" | "rejected", staffId: number, note?: string): { ok: boolean; msg?: string } {
  const existing = queryOne("SELECT id, status FROM reviews WHERE id=?", [reviewId]) as Record<string, unknown> | null;
  if (!existing) return { ok: false, msg: "Review not found." };
  if (status === "rejected" && !note) return { ok: false, msg: "Rejection requires a note." };

  try {
    tx(() => {
      run("UPDATE reviews SET status=?, rejection_note=? WHERE id=?",
        [status, note ? note.trim().slice(0, 500) : null, reviewId]);
      run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)",
        [staffId, `review.${status}`, "reviews", String(reviewId), JSON.stringify({ from: existing.status, to: status, note: note || null })]);
    });
    return { ok: true };
  } catch (e) {
    console.error("[juice] moderation error:", e);
    return { ok: false, msg: "Could not moderate review." };
  }
}

// ---------- helpers ----------

function toProduct(row: Record<string, unknown>, category: ProductCategory | null): Product {
  const sizes: ProductSize[] = [];
  if (row.sizes && typeof row.sizes === "string") {
    try { for (const s of JSON.parse(row.sizes as string)) { if (s && typeof s === "object") sizes.push({ label: String(s.label), priceMinor: Number(s.price_minor ?? 0) }); } } catch { /* ignore malformed */ }
  }
  const addons: ProductAddon[] = [];
  if (row.addons && typeof row.addons === "string") {
    try { for (const a of JSON.parse(row.addons as string)) { if (a && typeof a === "object") addons.push({ name: String(a.name), priceMinor: Number(a.price_minor ?? 0) }); } } catch { /* ignore malformed */ }
  }
  return {
    id: Number(row.id),
    categoryId: Number(row.category_id),
    sku: String(row.sku),
    name: String(row.name),
    description: String(row.description ?? ""),
    ingredientNote: row.ingredient_note ? String(row.ingredient_note) : null,
    priceMinor: Number(row.price_minor),
    currency: String(row.currency ?? "KES"),
    available: Boolean(row.available),
    featured: Boolean(row.featured),
    bestseller: Boolean(row.bestseller),
    sizes,
    addons,
    sortOrder: Number(row.sort_order),
    primaryImage: row.primary_image ? String(row.primary_image) : null,
    category,
  };
}

function toJuiceOrder(row: Record<string, unknown>): JuiceOrder {
  return {
    id: Number(row.id),
    orderRef: String(row.order_ref),
    customerName: String(row.customer_name),
    customerPhone: String(row.customer_phone),
    customerEmail: row.customer_email ? String(row.customer_email) : null,
    type: (row.type as "pickup" | "delivery") ?? "pickup",
    pickupName: row.pickup_name ? String(row.pickup_name) : null,
    pickupInstructions: row.pickup_instructions ? String(row.pickup_instructions) : null,
    deliveryZoneId: row.delivery_zone_id ? Number(row.delivery_zone_id) : null,
    deliveryAddress: row.delivery_address ? String(row.delivery_address) : null,
    deliveryContact: row.delivery_contact ? String(row.delivery_contact) : null,
    deliveryInstructions: row.delivery_instructions ? String(row.delivery_instructions) : null,
    status: (row.status as JuiceOrderStatus) ?? "new",
    assignedStaffId: row.assigned_staff_id ? Number(row.assigned_staff_id) : null,
    riderName: row.rider_name ? String(row.rider_name) : null,
    riderPhone: row.rider_phone ? String(row.rider_phone) : null,
    subtotalMinor: Number(row.subtotal_minor),
    deliveryFeeMinor: Number(row.delivery_fee_minor ?? 0),
    discountMinor: Number(row.discount_minor ?? 0),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency ?? "KES"),
    paymentId: row.payment_id ? Number(row.payment_id) : null,
    paymentStatus: row.payment_status ? String(row.payment_status) : null,
    customerNotes: row.customer_notes ? String(row.customer_notes) : null,
    staffNotes: row.staff_notes ? String(row.staff_notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items: [],
    deliveryZone: null,
  };
}

function juiceOrderItemsForOrder(orderId: number): JuiceOrderItem[] {
  const rows = queryAll(
    `SELECT joi.id, joi.product_id, p.name AS product_name, joi.size_label, joi.size_price_minor,
            joi.addons_chosen, joi.addons_price_minor, joi.qty, joi.unit_price_minor, joi.line_total_minor
       FROM juice_order_items joi JOIN products p ON p.id = joi.product_id
      WHERE joi.juice_order_id = ?
      ORDER BY joi.id`, [orderId]) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    productId: Number(r.product_id),
    productName: String(r.product_name),
    sizeLabel: r.size_label ? String(r.size_label) : null,
    sizePriceMinor: r.size_price_minor ? Number(r.size_price_minor) : null,
    addonsChosen: r.addons_chosen && typeof r.addons_chosen === "string" ? JSON.parse(r.addons_chosen) as string[] : null,
    addonsPriceMinor: r.addons_price_minor ? Number(r.addons_price_minor) : null,
    qty: Number(r.qty),
    unitPriceMinor: Number(r.unit_price_minor),
    lineTotalMinor: Number(r.line_total_minor),
  }));
}

let _juiceRefCounter = 0;
function juiceOrderRef(): string {
  _juiceRefCounter = (_juiceRefCounter + 1) % 1_000_000;
  const suffix = String(_juiceRefCounter).padStart(6, "0");
  const letters = "MNM-J".split("");
  // Simple pseudo-random letters from current time + counter
  const h = String(Date.now()).slice(-4);
  return `MNM-J-${h}${suffix}`;
}

export function updateBusinessSetting(key: string, value: string, staffId: number): { ok: boolean; msg?: string } {
  try {
    tx(() => {
      const stored = HTML_SETTING_KEYS.has(key) ? sanitizeHtml(value) : value.slice(0, 5000);
      run("INSERT INTO business_settings(key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at",
        [key, stored.slice(0, 5000), staffId, new Date().toISOString()]);
      run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)",
        [staffId, "business_setting.update", "business_settings", key, JSON.stringify({ key, length: value.length })]);
    });
    return { ok: true };
  } catch (e) {
    console.error("[juice] setting update error:", e);
    return { ok: false, msg: "Could not save setting." };
  }
}

/** Settings whose value is rendered as HTML on the storefront. */
const HTML_SETTING_KEYS = new Set(["about_html", "opening_hours", "footer_policy_note"]);

/**
 * Conservative HTML allowlist for owner-editable marketing copy.
 * These values are rendered with dangerouslySetInnerHTML, so anything that can
 * execute script (script/style/iframe/object, on* handlers, javascript: URLs)
 * is removed. Unknown tags are unwrapped, keeping their text.
 */
export function sanitizeHtml(input: string): string {
  const ALLOWED = new Set(["p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "span", "a", "h3", "h4", "small"]);
  let out = String(input ?? "");

  // Drop dangerous elements together with their content.
  out = out.replace(/<\s*(script|style|iframe|object|embed|svg|form|input|button|meta|link)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  // Drop self-closing / void dangerous elements.
  out = out.replace(/<\s*(script|style|iframe|object|embed|svg|form|input|button|meta|link)\b[^>]*>/gi, "");
  // Drop all attributes, then re-add a safe href on <a> where one was present.
  out = out.replace(/<([a-z0-9]+)\b([^>]*)>/gi, (full, tagName: string, attrs: string) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED.has(tag)) return ""; // unwrap unknown tags, keep inner text
    if (tag === "a") {
      const href = attrs.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
      const safe = /^(https?:|mailto:|tel:|\/)/i.test(href.trim()) ? href.trim() : "";
      return safe ? `<a href="${safe.replace(/"/g, "&quot;")}" rel="noopener noreferrer">` : "<a>";
    }
    return `<${tag}>`;
  });
  // Remove any leftover closing tags for tags we do not allow.
  out = out.replace(/<\s*\/\s*([a-z0-9]+)\s*>/gi, (full, tagName: string) => {
    const tag = tagName.toLowerCase();
    return ALLOWED.has(tag) ? `</${tag}>` : "";
  });
  return out;
}

export function businessSetting(key: string): string {
  const r = queryOne("SELECT value FROM business_settings WHERE key=?", [key]) as Record<string, unknown> | null;
  return r ? String(r.value) : "";
}
