/** Juice staff routes: owner + assistant dashboard for managing products, orders, delivery zones, reviews.
 * Two-person operations: owner (full) and assistant (restricted).
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppConfig } from "../config.ts";
import { SESSION_COOKIE, getSessionUser, roleAllows, stateChangeOriginAllowed } from "../auth.ts";
import { tx, run, queryOne, queryAll } from "../db.ts";
import {
  allCategories, categoryById, productsInCategory, featuredProducts, bestsellerProducts, allProducts, productById, searchProducts,
  createJuiceOrder, updateJuiceOrderStatus, assignJuiceOrder, recentJuiceOrders, juiceOrderById, juiceOrderByRef,
  enabledDeliveryZones, deliveryZoneById,
  approvedReviewsForProduct, allApprovedReviews, averageRating, submitReview, moderateReview,
  updateBusinessSetting, businessSetting,
  recentCateringEnquiries, updateCateringEnquiryStatus, CATERING_STATUSES,
  type Product, type ProductCategory, type JuiceOrder, type JuiceOrderStatus, type DeliveryZone, type Review,
  type CateringStatus,
} from "../juice.ts";
import { formatMinor } from "../money.ts";
import { StaffPage, PlainPage } from "../views/layout.tsx";

type SessionUser = NonNullable<ReturnType<typeof getSessionUser>>;

/** Raw review rows for the moderation list (snake_case SQL columns; rejection_note
 * is aliased to rejectionNote to match what the JSX below reads). */
interface StaffReviewRow {
  id: number;
  rating: number;
  author_name: string;
  product_name: string | null;
  is_verified: number;
  created_at: string;
  status: string;
  body: string;
  rejectionNote: string | null;
}

/** Staff member option for the order-assignment dropdown. */
interface StaffOption {
  id: number;
  fullName: string;
  role: string;
}

function staff(c: Context, config: AppConfig, cap: "manage" | "reports" | "admin"): SessionUser | null {
  if (!stateChangeOriginAllowed(c, config.publicOrigins) && c.req.method !== "GET") return null;
  const u = getSessionUser(getCookie(c, SESSION_COOKIE));
  return u && roleAllows(u.role, cap) ? u : null;
}

function canManageProducts(u: SessionUser | null): boolean {
  return !!(u && (u.role === "owner" || u.role === "manager" || u.role === "sales_staff"));
}

function canManageOrders(u: SessionUser | null): boolean {
  return !!(u && (u.role === "owner" || u.role === "manager" || u.role === "sales_staff"));
}

export function juiceStaffRoutes(config: AppConfig): Hono {
  const app = new Hono();

  // ---------- OWNER/ASSISTANT DASHBOARD ----------
  app.get("/staff/juice", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff/juice");

    const orders = recentJuiceOrders(20);
    const newCount = orders.filter((o) => o.status === "new").length;
    const preparingCount = orders.filter((o) => o.status === "preparing").length;
    const readyCount = orders.filter((o) => o.status === "ready_for_pickup" || o.status === "ready_for_dispatch").length;
    const outCount = orders.filter((o) => o.status === "out_for_delivery").length;
    const deliveredToday = orders.filter((o) => o.status === "delivered" && new Date(o.createdAt).toDateString() === new Date().toDateString()).length;
    const totalToday = orders.filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString()).length;

    // Sales totals today
    const todayOrders = orders.filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString());
    const todayRevenue = todayOrders.reduce((s, o) => s + o.totalMinor, 0);

    // Featured products
    const featured = featuredProducts(4);
    const bestsellers = bestsellerProducts(4);

    // Sales + availability summary (derived from the orders themselves, so the
    // numbers can never drift from the underlying data).
    const summary = buildSalesSummary();

    return c.html(
      <StaffPage title="Juice Bar — Dashboard" >

        <h1>Juice Bar dashboard</h1>
        <p class="muted">Signed in as <strong>{u.fullName}</strong> ({u.role}).</p>

        <div class="stat-grid">
          <div class="stat"><div class="v">{newCount}</div><div class="k">new orders</div></div>
          <div class="stat"><div class="v">{preparingCount}</div><div class="k">being prepared</div></div>
          <div class="stat"><div class="v">{readyCount}</div><div class="k">ready</div></div>
          <div class="stat"><div class="v">{outCount}</div><div class="k">out for delivery</div></div>
          <div class="stat"><div class="v">{deliveredToday}</div><div class="k">delivered today</div></div>
          <div class="stat"><div class="v">{totalToday}</div><div class="k">orders today</div></div>
          <div class="stat"><div class="v">{formatMinor(todayRevenue, "KES")}</div><div class="k">revenue today</div></div>
        </div>

        <div class="actions-row">
          <a class="btn btn-primary" href="/staff/juice/orders">View all orders</a>
          <a class="btn btn-secondary" href="/staff/juice/products">Manage products</a>
          <a class="btn btn-secondary" href="/staff/juice/delivery">Delivery zones</a>
          <a class="btn btn-secondary" href="/staff/juice/catering">Catering enquiries</a>
          <a class="btn btn-secondary" href="/staff/juice/reviews">Reviews</a>
          <a class="btn btn-ghost" href="/staff/juice/settings">Settings</a>
        </div>

        {/* SALES SUMMARY */}
        <h2>Sales summary</h2>
        <div class="stat-grid">
          <div class="stat"><div class="v">{formatMinor(summary.weekRevenueMinor, "KES")}</div><div class="k">revenue · last 7 days</div></div>
          <div class="stat"><div class="v">{summary.weekOrders}</div><div class="k">orders · last 7 days</div></div>
          <div class="stat"><div class="v">{formatMinor(summary.avgOrderMinor, "KES")}</div><div class="k">average order value</div></div>
          <div class="stat"><div class="v">{summary.unitsSold}</div><div class="k">drinks/snacks sold · 7d</div></div>
          <div class="stat"><div class="v">{summary.deliverySharePct}%</div><div class="k">delivery share · 7d</div></div>
          <div class="stat"><div class="v">{summary.openCatering}</div><div class="k">open catering enquiries</div></div>
        </div>

        <div class="panel">
          <h3>Best sellers · last 7 days</h3>
          {summary.topProducts.length === 0 ? (
            <p class="muted">No sales recorded in the last 7 days yet.</p>
          ) : (
            <table class="orders-table">
              <thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
              <tbody>
                {summary.topProducts.map((t) => (
                  <tr key={t.name}>
                    <td><strong>{t.name}</strong></td>
                    <td>{t.qty}</td>
                    <td><strong>{formatMinor(t.revenueMinor, "KES")}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* CATALOGUE / AVAILABILITY */}
        <h2>Catalogue &amp; availability</h2>
        <div class="panel">
          <p class="muted">
            {summary.totalProducts} products in the catalogue · {summary.availableProducts} available to customers · {summary.unavailableProducts} currently unavailable.
          </p>
          {summary.unavailableList.length > 0 ? (
            <>
              <p class="small muted">Unavailable right now (hidden from the storefront):</p>
              <ul class="review-list">
                {summary.unavailableList.map((p) => (
                  <li key={p.id}>
                    <strong>{p.name}</strong> <span class="muted small">— {p.categoryName}</span>
                    <div class="mini-product-actions">
                      <a class="btn btn-ghost btn-sm" href={`/staff/juice/products/${p.id}`}>Edit product</a>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p class="muted small">Every product in the catalogue is currently available.</p>
          )}
        </div>

        {/* Recent orders */}
        <h2>Recent juice orders</h2>
        {orders.length === 0 ? (
          <div class="panel"><p class="muted">No juice orders yet.</p></div>
        ) : (
          <div class="panel">
            <table class="orders-table">
              <thead>
                <tr><th>Ref</th><th>Customer</th><th>Type</th><th>Total</th><th>Status</th><th>Fulfilled by</th><th>Placed</th><th></th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><strong>{o.orderRef}</strong></td>
                    <td>{o.customerName}<br /><small class="muted">{o.customerPhone}</small></td>
                    <td>{o.type === "pickup" ? "Pickup" : "Delivery"}</td>
                    <td>{formatMinor(o.totalMinor, o.currency)}</td>
                    <td><span class={`tag ${o.status === "new" ? "warn" : o.status === "delivered" ? "ok" : "ok"}`}>{o.status}</span></td>
                    <td>{o.assignedStaffId ? `Staff #${o.assignedStaffId}` : "—"}</td>
                    <td>{new Date(o.createdAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td><a class="btn btn-ghost btn-sm" href={`/staff/juice/orders/${o.id}`}>View</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent reviews */}
        <h2>Recent customer reviews</h2>
        <div class="panel">
          {allApprovedReviews().length === 0 ? (
            <p class="muted">No approved reviews yet.</p>
          ) : (
            <ul class="review-list">
              {allApprovedReviews().slice(0, 5).map((r) => (
                <li key={r.id}>
                  <div class="review-stars">{stars(r.rating)}</div>
                  <div class="review-body">
                    <p>{r.body}</p>
                    <p class="muted small">— {r.authorName} {r.isVerified ? <span class="verified-tag">Verified purchase</span> : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Featured products */}
        <h2>Featured products</h2>
        <div class="panel">
          {featured.length === 0 ? <p class="muted">No featured products.</p> : (
            <div class="product-grid-small">
              {featured.map((p) => (
                <div class="mini-product" key={p.id}>
                  <div class="mini-product-name">{p.name}</div>
                  <div class="mini-product-price">{formatMinor(p.priceMinor, p.currency)}</div>
                  <div class="mini-product-actions">
                    <a class="btn btn-ghost btn-sm" href={`/staff/juice/products/${p.id}`}>Edit</a>
                    <a class="btn btn-ghost btn-sm" href={`/product/${p.id}`} target="_blank">View</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </StaffPage>
    );
  });

  // ---------- JUICE ORDERS LIST ----------
  app.get("/staff/juice/orders", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/orders");

    const statusFilter = c.req.query("status");
    const orders = recentJuiceOrders(200).filter((o) => !statusFilter || o.status === statusFilter);

    return c.html(
      <StaffPage title="Juice orders">

        <h1>Juice orders</h1>
        <div class="filters-row">
          <a class="filter-link" href="/staff/juice/orders">All</a>
          <a class="filter-link" href="/staff/juice/orders?status=new">New</a>
          <a class={`filter-link${statusFilter === "accepted" ? " active" : ""}`} href="/staff/juice/orders?status=accepted">Accepted</a>
<a class="filter-link" href="/staff/juice/orders?status=preparing">Preparing</a>
<a class="filter-link" href="/staff/juice/orders?status=ready_for_pickup">Ready</a>
<a class="filter-link" href="/staff/juice/orders?status=out_for_delivery">Out for delivery</a>
<a class="filter-link" href="/staff/juice/orders?status=delivered">Delivered</a>
        </div>

        <div class="panel">
          <table class="orders-table">
            <thead>
              <tr><th>Ref</th><th>Customer</th><th>Phone</th><th>Type</th><th>Total</th><th>Payment</th><th>Status</th><th>Staff</th><th>Placed</th><th></th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.orderRef}</strong></td>
                  <td>{o.customerName}</td>
                  <td><a class="phone-link" href={`tel:${o.customerPhone}`}>{o.customerPhone}</a></td>
                  <td>{o.type === "pickup" ? "Pickup" : "Delivery"}{o.deliveryZone ? ` · ${o.deliveryZone.name}` : ""}</td>
                  <td><strong>{formatMinor(o.totalMinor, o.currency)}</strong></td>
                  <td>
                    {o.paymentStatus ? (
                      <span class={`tag ${o.paymentStatus === "succeeded" ? "ok" : o.paymentStatus === "failed" ? "danger" : ""}`}>{o.paymentStatus}</span>
                    ) : (
                      <span class="tag warn">pending</span>
                    )
                  }
                  </td>
                  <td><span class={`tag ${o.status === "new" ? "warn" : o.status === "delivered" ? "ok" : "ok"}`}>{statusLabelFor(o.status)}</span></td>
                  <td>{o.assignedStaffId ? `Staff #${o.assignedStaffId}` : "—"}{o.riderName ? ` · ${o.riderName}` : ""}</td>
                  <td>{new Date(o.createdAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td><a class="btn btn-ghost btn-sm" href={`/staff/juice/orders/${o.id}`}>View</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StaffPage>
    );
  });

  // ---------- JUICE ORDER DETAIL + STATUS ACTIONS ----------
  app.get("/staff/juice/orders/:id", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/orders/" + c.req.param("id"));

    const id = Number(c.req.param("id"));
    const order = juiceOrderById(id);
    if (!order) return c.text("Order not found", 404);

    const canManage = canManageOrders(u);
    const nextStatuses = nextStatusesFor(order.status, order.type);
    const staffList = canManage
      ? queryAll(
          `SELECT id, full_name AS fullName, role FROM users
            WHERE is_active = 1 AND role IN ('owner','manager','sales_staff')
            ORDER BY full_name`,
        ) as unknown as StaffOption[]
      : [];

    return c.html(
      <StaffPage title={`Order ${order.orderRef}`} active="/staff/juice/orders">
        <div class="page-head">
          <p class="kicker">Order {order.orderRef}</p>
          <h1>{statusLabelFor(order.status)}</h1>
          <div class="actions-row">
            <a class="btn btn-ghost" href="/staff/juice/orders">&larr; All orders</a>
            {canManage ? <a class="btn btn-secondary" href={`/staff/juice/orders/${order.id}/receipt`}>Printable receipt</a> : null}
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat"><div class="v">{formatMinor(order.totalMinor, order.currency)}</div><div class="k">order total</div></div>
          <div class="stat"><div class="v">{order.type === "pickup" ? "Pickup" : "Delivery"}</div><div class="k">fulfilment</div></div>
          <div class="stat"><div class="v">{order.paymentStatus ?? "pending"}</div><div class="k">payment</div></div>
          <div class="stat"><div class="v">{order.items.reduce((s, i) => s + i.qty, 0)}</div><div class="k">items</div></div>
        </div>

        <div class="section-alt">
          <div class="contact-grid">
            <div>
              <h3>Customer</h3>
              <div class="order-meta">
                <div><strong>{order.customerName}</strong></div>
                <div><a class="phone-link" href={`tel:${order.customerPhone}`}>{order.customerPhone}</a></div>
                {order.customerEmail ? <div>{order.customerEmail}</div> : null}
              </div>
              <h3>Fulfilment</h3>
              <div class="order-meta">
                <div>{order.type === "pickup" ? "Pickup" : "Delivery"}{order.deliveryZone ? ` — ${order.deliveryZone.name}` : ""}</div>
                {order.deliveryAddress ? <div>Address: {order.deliveryAddress}</div> : null}
                {order.deliveryContact ? <div>Contact: {order.deliveryContact}</div> : null}
                {order.deliveryInstructions ? <div>Notes: {order.deliveryInstructions}</div> : null}
                {order.pickupName ? <div>Collect under: {order.pickupName}</div> : null}
                {order.pickupInstructions ? <div>Pickup notes: {order.pickupInstructions}</div> : null}
              </div>
              {order.customerNotes ? (
                <div class="order-notes"><strong>Customer note:</strong> {order.customerNotes}</div>
              ) : null}
            </div>

            <div>
              <h3>Items</h3>
              <table class="order-items-table">
                <thead><tr><th>Drink / snack</th><th>Size</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.productName}</strong>{item.addonsChosen && item.addonsChosen.length ? <div class="muted small">{item.addonsChosen.join(", ")}</div> : null}</td>
                      <td>{item.sizeLabel ?? "Standard"}</td>
                      <td>{item.qty}</td>
                      <td>{formatMinor(item.unitPriceMinor, order.currency)}</td>
                      <td><strong>{formatMinor(item.lineTotalMinor, order.currency)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={4}>Subtotal</td><td>{formatMinor(order.subtotalMinor, order.currency)}</td></tr>
                  {order.deliveryFeeMinor > 0 ? (
                    <tr><td colSpan={4}>Delivery fee</td><td>{formatMinor(order.deliveryFeeMinor, order.currency)}</td></tr>
                  ) : null}
                  {order.discountMinor > 0 ? (
                    <tr><td colSpan={4}>Discount</td><td>&minus;{formatMinor(order.discountMinor, order.currency)}</td></tr>
                  ) : null}
                  <tr class="total-row"><td colSpan={4}><strong>Total</strong></td><td><strong>{formatMinor(order.totalMinor, order.currency)}</strong></td></tr>
                </tfoot>
              </table>
              <p class="muted small">Placed {new Date(order.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</p>
              {order.staffNotes ? (
                <div class="order-notes"><strong>Staff notes:</strong> {order.staffNotes}</div>
              ) : null}
            </div>
          </div>
        </div>

        {canManage ? (
          <div class="panel">
            <h2>Update this order</h2>
            {nextStatuses.length === 0 ? (
              <p class="muted">This order is {statusLabelFor(order.status).toLowerCase()} — no further status changes are possible.</p>
            ) : (
              <form method="post" action={`/staff/juice/orders/${order.id}/status`} class="form-section">
                <div class="form-row">
                  <div class="field">
                    <label for="status">Move to status</label>
                    <select id="status" name="status" required>
                      {nextStatuses.map((s) => <option value={s}>{statusLabelFor(s)}</option>)}
                    </select>
                  </div>
                  <div class="field">
                    <label for="status-note">Staff note (optional)</label>
                    <input id="status-note" name="note" type="text" maxLength={500} placeholder="e.g. Extra mango added" />
                  </div>
                </div>
                <button class="btn btn-primary" type="submit">Update status</button>
              </form>
            )}

            <form method="post" action={`/staff/juice/orders/${order.id}/assign`} class="form-section">
              <h3>Who is handling this order?</h3>
              <div class="form-row">
                <div class="field">
                  <label for="staffId">Staff member</label>
                  <select id="staffId" name="staffId" required>
                    <option value="">Choose…</option>
                    {staffList.map((s) => (
                      <option value={String(s.id)} {...(order.assignedStaffId === s.id ? { selected: true } : {})}>{s.fullName} ({s.role})</option>
                    ))}
                  </select>
                </div>
                <div class="field">
                  <label for="riderName">Rider / handler name</label>
                  <input id="riderName" name="riderName" type="text" maxLength={80} value={order.riderName ?? ""} placeholder="e.g. Mercy (rider)" />
                </div>
                <div class="field">
                  <label for="riderPhone">Rider phone</label>
                  <input id="riderPhone" name="riderPhone" type="tel" maxLength={30} value={order.riderPhone ?? ""} placeholder="+2547…" />
                </div>
              </div>
              <button class="btn btn-secondary" type="submit">Assign order</button>
            </form>
          </div>
        ) : (
          <div class="panel"><p class="muted">You have read-only access to this order.</p></div>
        )}
      </StaffPage>
    );
  });

  // ---------- STATUS UPDATE ----------
  app.post("/staff/juice/orders/:id/status", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);

    const id = Number(c.req.param("id"));
    const body = await c.req.parseBody() as Record<string, string>;
    const status = body.status as JuiceOrderStatus;
    const note = body.note || "";

    const result = updateJuiceOrderStatus(id, status, u.id, note);
    if (!result.ok) {
      return c.html(
        <StaffPage title="Cannot update status">
          <div class="panel notice bad">{result.msg}</div>
          <p><a class="btn btn-ghost" href={`/staff/juice/orders/${id}`}>Back</a></p>
        </StaffPage>,
        400
      );
    }
    return c.redirect(`/staff/juice/orders/${id}`);
  });

  // ---------- ASSIGN ----------
  app.post("/staff/juice/orders/:id/assign", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);

    const id = Number(c.req.param("id"));
    const body = await c.req.parseBody() as Record<string, string>;
    const staffId = Number(body.staffId);
    const riderName = body.riderName || "";
    const riderPhone = body.riderPhone || "";

    if (!staffId || isNaN(staffId)) {
      return c.html(
        <StaffPage title="Assign error">
          <div class="panel notice bad">Please select a staff member.</div>
          <p><a class="btn btn-ghost" href={`/staff/juice/orders/${id}`}>Back</a></p>
        </StaffPage>,
        400
      );
    }

    const result = assignJuiceOrder(id, staffId, riderName || undefined, riderPhone || undefined);
    if (!result.ok) {
      return c.html(
        <StaffPage title="Assign error">
          <div class="panel notice bad">{result.msg}</div>
          <p><a class="btn btn-ghost" href={`/staff/juice/orders/${id}`}>Back</a></p>
        </StaffPage>,
        400
      );
    }
    return c.redirect(`/staff/juice/orders/${id}`);
  });

  // ---------- RECEIPT (PRINT) ----------
  app.get("/staff/juice/orders/:id/receipt", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/orders/" + c.req.param("id") + "/receipt");

    const id = Number(c.req.param("id"));
    const order = juiceOrderById(id);
    if (!order) return c.text("Order not found", 404);

    const canPrint = canManageOrders(u);
    if (!canPrint) return c.text("Not permitted", 403);

    const statusLabel = statusLabelFor(order.status);
    const isPaid = order.paymentStatus === "succeeded";

    return c.html(
      <PlainPage title={`Receipt — Order ${order.orderRef}`} active="/staff/juice/orders/${id}">
        {!canPrint ? null : <div class="no-print"><a class="btn btn-ghost" href={`/staff/juice/orders/${order.id}`}>← Back to order</a></div>}

        <div class="receipt">
          <div class="receipt-paper">
            <div class="receipt-header">
              <div class="receipt-brand">
                <div class="receipt-brand-mark">MnM</div>
                <div class="receipt-brand-name">Juice Bar</div>
              </div>
              <div class="receipt-contact">
                <div>{businessSetting("address_line")}</div>
                <div>Phone: {businessSetting("contact_phone")}</div>
              </div>
            </div>

            <hr class="receipt-rule" />

            <div class="receipt-title">ORDER RECEIPT</div>
            <div class="receipt-ref">Order reference: <strong>{order.orderRef}</strong></div>
            <div class="receipt-date">Date: {new Date(order.createdAt).toLocaleString("en-KE", { dateStyle: "long", timeStyle: "short" })}</div>

            <hr class="receipt-rule" />

            {/* CUSTOMER */}
            <div class="receipt-section">
              <div class="receipt-section-label">Customer</div>
              <div class="receipt-customer">
                <div><strong>{order.customerName}</strong></div>
                <div>{order.customerPhone}</div>
                {order.customerEmail && <div>{order.customerEmail}</div>}
              </div>
            </div>

            {/* TYPE */}
            <div class="receipt-section">
              <div class="receipt-section-label">Type</div>
              <div>{order.type === "pickup" ? "Pickup" : "Delivery"}{order.deliveryZone ? ` — ${order.deliveryZone.name}` : ""}</div>
              {order.deliveryAddress && <div>Address: {order.deliveryAddress}</div>}
              {order.deliveryContact && <div>Contact: {order.deliveryContact}</div>}
              {order.deliveryInstructions && <div>Notes: {order.deliveryInstructions}</div>}
            </div>

            {/* STATUS */}
            <div class="receipt-section">
              <div class="receipt-section-label">Status</div>
              <div>{statusLabel}{isPaid ? " · Paid" : ""}</div>
            </div>

            {/* ITEMS */}
            <div class="receipt-section">
              <div class="receipt-section-label">Items</div>
              <table class="order-items-table">
                <thead><tr><th>Drink / snack</th><th>Size</th><th>Add-ons</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.productName}</strong></td>
                      <td>{item.sizeLabel ?? "Standard"}</td>
                      <td class="small">{item.addonsChosen && item.addonsChosen.length ? item.addonsChosen.join(", ") : "—"}</td>
                      <td>{item.qty}</td>
                      <td>{formatMinor(item.unitPriceMinor, order.currency)}</td>
                      <td><strong>{formatMinor(item.lineTotalMinor, order.currency)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={5}>Subtotal</td><td>{formatMinor(order.subtotalMinor, order.currency)}</td></tr>
                  {order.deliveryFeeMinor > 0 && (
                    <tr><td colSpan={5}>Delivery fee</td><td>{formatMinor(order.deliveryFeeMinor, order.currency)}</td></tr>
                  )}
                  {order.discountMinor > 0 && (
                    <tr><td colSpan={5}>Discount</td><td>−{formatMinor(order.discountMinor, order.currency)}</td></tr>
                  )}
                  <tr class="total-row"><td colSpan={5}><strong>Total payable</strong></td><td><strong>{formatMinor(order.totalMinor, order.currency)}</strong></td></tr>
                </tfoot>
              </table>
            </div>

            {order.staffNotes && (
              <div class="receipt-section">
                <h3>Staff notes</h3>
                <p>{order.staffNotes}</p>
              </div>
            )}

            <div class="receipt-actions">
              {canPrint && <a class="btn btn-primary" href={`/staff/juice/orders/${order.id}`}>← Back to order</a>}
            </div>
          </div>
        </div>
      </PlainPage>
    );
  });

  app.get("/staff/juice/products", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/products");
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const q = (c.req.query("q") || "").trim();
    const products = q ? searchProducts(q) : allProducts();
    const saved = c.req.query("saved");
    return c.html(
      <StaffPage title="Products — Juice Bar" active="/staff/juice/products">

        <h1>Products</h1>
        {saved ? <div class="panel notice ok" role="status">Product saved.</div> : null}
        <div class="actions-row">
          <a class="btn btn-primary" href="/staff/juice/products/new">Add product</a>
          <form method="get" action="/staff/juice/products" style={{ display: "inline" }}>
            <input type="search" name="q" placeholder="Search products…" value={q} aria-label="Search products" />
            <button class="btn btn-ghost" type="submit">Search</button>
          </form>
        </div>
        <div class="panel">
          {products.length === 0 ? (
            <p class="muted">{q ? `No products match “${q}”.` : "No products yet — add your first product."}</p>
          ) : (
            <table class="orders-table">
              <thead><tr><th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong>{p.featured ? <span class="tag ok">Featured</span> : null}{p.bestseller ? <span class="tag warn">Bestseller</span> : null}</td>
                    <td>{p.sku}</td>
                    <td>{p.category?.name ?? "—"}</td>
                    <td>{formatMinor(p.priceMinor, p.currency)}</td>
                    <td><span class={`tag ${p.available ? "ok" : "danger"}`}>{p.available ? "Available" : "Unavailable"}</span></td>
                    <td><a class="btn btn-ghost btn-sm" href={`/staff/juice/products/${p.id}`}>Edit</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </StaffPage>
    );
  });

  app.get("/staff/juice/products/new", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/products/new");
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    return productFormPage(c, null, allCategories(), []);
  });

  app.get("/staff/juice/products/:id", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/products/" + c.req.param("id"));
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const id = Number(c.req.param("id"));
    const product = productById(id);
    if (!product) return c.text("Product not found", 404);

    return productFormPage(c, product, allCategories(), []);
  });

  const saveProduct = async (c: Context) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const body = await c.req.parseBody() as Record<string, string>;
    const productId = body.id ? Number(body.id) : c.req.param("id") ? Number(c.req.param("id")) : undefined;
    const values = valuesFromBody(body);
    const errors: string[] = [];

    const name = values.name;
    if (!name) errors.push("Product name is required.");
    else if (name.length > 120) errors.push("Product name must be 120 characters or fewer.");

    const categoryId = Number(values.categoryId);
    if (!values.categoryId || !Number.isInteger(categoryId) || !categoryById(categoryId)) {
      errors.push("Please choose a valid category.");
    }

    let priceMinor = NaN;
    if (!values.price) errors.push("Price is required.");
    else if (!/^\d{1,7}(\.\d{1,2})?$/.test(values.price)) errors.push("Price must be a valid amount in KES, e.g. 150 or 150.50.");
    else {
      priceMinor = Math.round(parseFloat(values.price) * 100);
      if (!Number.isInteger(priceMinor) || priceMinor <= 0) errors.push("Price must be greater than zero.");
    }

    let sku = values.sku;
    if (sku && !/^[A-Za-z0-9_-]{1,40}$/.test(sku)) errors.push("SKU may only contain letters, numbers, dashes and underscores (max 40 characters).");
    if (!sku) sku = "PRD-" + String(Date.now()).slice(-6);

    let sortOrder = NaN;
    if (!/^\d{1,5}$/.test(values.sortOrder)) errors.push("Sort order must be a whole number (0–99999).");
    else sortOrder = Number(values.sortOrder);

    const sizesParsed = parseAddonsOrSizesJson(values.sizesJson, "sizes");
    if (!sizesParsed.ok) errors.push(sizesParsed.msg);
    const addonsParsed = parseAddonsOrSizesJson(values.addonsJson, "addons");
    if (!addonsParsed.ok) errors.push(addonsParsed.msg);
    const sizesJson = sizesParsed.ok ? sizesParsed.value : null;
    const addonsJson = addonsParsed.ok ? addonsParsed.value : null;

    const existing = productId ? productById(productId) : null;
    if (productId && !existing) errors.push("Product not found — nothing to update.");

    if (errors.length) {
      return productFormPage(c, existing, allCategories(), errors, values, 400);
    }

    const available = values.available;
    const featured = values.featured;
    const bestseller = values.bestseller;
    const description = values.description.trim().slice(0, 2000);
    const ingredientNote = values.ingredientNote.trim().slice(0, 1000) || null;

    const updateSql = `UPDATE products SET category_id=?, sku=?, name=?, description=?, ingredient_note=?, price_minor=?, available=?, featured=?, bestseller=?, sizes=COALESCE(?, sizes), addons=COALESCE(?, addons), sort_order=?, updated_at=? WHERE id=?`;
    const insertSql = `INSERT INTO products(category_id, sku, name, description, ingredient_note, price_minor, available, featured, bestseller, sizes, addons, sort_order, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    try {
      tx(() => {
        if (productId) {
          run(updateSql, [categoryId, sku, name, description, ingredientNote, priceMinor, available ? 1 : 0, featured ? 1 : 0, bestseller ? 1 : 0, sizesJson, addonsJson, sortOrder, new Date().toISOString(), productId]);
          run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)", [u.id, "product.update", "products", String(productId), JSON.stringify({ name, price: priceMinor, available, featured, bestseller })]);
        } else {
          run(insertSql, [categoryId, sku, name, description, ingredientNote, priceMinor, available ? 1 : 0, featured ? 1 : 0, bestseller ? 1 : 0, sizesJson, addonsJson, sortOrder, u.id, new Date().toISOString(), new Date().toISOString()]);
          const id = queryOne("SELECT last_insert_rowid() AS id")!.id as number;
          run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)", [u.id, "product.create", "products", String(id), JSON.stringify({ name, categoryId, price: priceMinor })]);
        }
      });
    } catch (e) {
      console.error("[juice] product save error:", e);
      const msg = String((e as Error).message || e);
      if (msg.includes("UNIQUE constraint failed")) {
        return productFormPage(c, existing, allCategories(), ["That SKU is already used by another product — choose a different SKU."], values, 400);
      }
      return c.html(
        <StaffPage title="Error">
          <div class="panel notice bad">Could not save product. Please try again — if the problem persists, call support.</div>
          <p><a class="btn btn-ghost" href="/staff/juice/products">Back</a></p>
        </StaffPage>,
        500
      );
    }

    return c.redirect("/staff/juice/products?saved=1");
  };
  app.post("/staff/juice/products", saveProduct);
  app.post("/staff/juice/products/:id", saveProduct);

  // ---------- DELIVERY ZONES ----------
  app.get("/staff/juice/delivery", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/delivery");
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const zones = enabledDeliveryZones().concat(
      queryAll(`SELECT id, name, description, fee_minor AS feeMinor, min_order_minor AS minOrderMinor, enabled, sort_order AS sortOrder FROM delivery_zones WHERE enabled=0 ORDER BY sort_order, name`) as unknown as DeliveryZone[],
    ).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return c.html(
      <StaffPage title="Delivery zones — Juice Bar" >

        <h1>Delivery zones</h1>
        <p class="muted">Configure delivery areas and fees. Zones can be enabled or disabled without deleting them.</p>

        <div class="actions-row">
          <a class="btn btn-primary" href="/staff/juice/delivery/new">Add zone</a>
        </div>

        <div class="panel">
          <table class="delivery-table">
            <thead>
              <tr><th>Zone</th><th>Description</th><th>Delivery fee</th><th>Min order</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td><strong>{z.name}</strong></td>
                  <td>{z.description}</td>
                  <td>{formatMinor(z.feeMinor, "KES")}</td>
                  <td>{z.minOrderMinor > 0 ? formatMinor(z.minOrderMinor, "KES") : "None"}</td>
                  <td><span class={`tag ${z.enabled ? "ok" : "warn"}`}>{z.enabled ? "Enabled" : "Disabled"}</span></td>
                  <td><a class="btn btn-ghost btn-sm" href={`/staff/juice/delivery/${z.id}`}>Edit</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StaffPage>
    );
  });

  app.get("/staff/juice/delivery/new", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/delivery/new");
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    return c.html(
      <StaffPage title="New delivery zone" active="/staff/juice/delivery/new">

        <h1>Add delivery zone</h1>
        <form method="post" action="/staff/juice/delivery" class="panel">
          <div class="field">
            <label for="zone-name">Zone name</label>
            <input id="zone-name" type="text" name="name" defaultValue="" placeholder="e.g. Kabuku" required />
          </div>
          <div class="field">
            <label for="zone-desc">Description</label>
            <input id="zone-desc" type="text" name="description" defaultValue="" placeholder="e.g. Local delivery within Kabuku" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="zone-fee">Delivery fee (KES)</label>
              <input id="zone-fee" type="text" inputmode="decimal" name="fee" defaultValue="50" />
            </div>
            <div class="field">
              <label for="zone-min">Minimum order (KES)</label>
              <input id="zone-min" type="text" inputmode="decimal" name="minOrder" defaultValue="500" />
            </div>
            <div class="field">
              <label for="zone-sort">Sort order</label>
              <input id="zone-sort" type="number" name="sortOrder" min="0" max="99999" defaultValue="0" />
            </div>
          </div>
          <div class="field">
            <label for="zone-enabled">Enabled</label>
            <select id="zone-enabled" name="enabled">
              <option value="on" selected>Yes — customers can choose this zone</option>
              <option value="off">No — hidden from customers</option>
            </select>
          </div>
          <button class="btn btn-primary" type="submit">Add zone</button>
        </form>
      </StaffPage>
    );
  });

  app.get("/staff/juice/delivery/:id", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/delivery/" + c.req.param("id"));
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const id = Number(c.req.param("id"));
    const zone = deliveryZoneById(id);
    if (!zone) return c.text("Zone not found", 404);

    return c.html(
      <StaffPage title={`Edit zone — ${zone.name}`} active="/staff/juice/delivery/${id}">

        <h1>Edit zone — {zone.name}</h1>
        <form method="post" action="/staff/juice/delivery/${id}" class="panel">
          <div class="field">
            <label for="zone-name">Zone name</label>
            <input id="zone-name" type="text" name="name" defaultValue={zone.name} placeholder="e.g. Kabuku" required />
          </div>
          <div class="field">
            <label for="zone-desc">Description</label>
            <input id="zone-desc" type="text" name="description" defaultValue={zone.description} placeholder="e.g. Local delivery within Kabuku" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="zone-fee">Delivery fee (KES)</label>
              <input id="zone-fee" type="text" inputmode="decimal" name="fee" defaultValue={(zone.feeMinor / 100).toFixed(2)} />
            </div>
            <div class="field">
              <label for="zone-min">Minimum order (KES)</label>
              <input id="zone-min" type="text" inputmode="decimal" name="minOrder" defaultValue={(zone.minOrderMinor / 100).toFixed(2)} />
            </div>
            <div class="field">
              <label for="zone-sort">Sort order</label>
              <input id="zone-sort" type="number" name="sortOrder" min="0" max="99999" defaultValue={zone.sortOrder} />
            </div>
          </div>
          <div class="field">
            <label for="zone-enabled">Enabled</label>
            <select id="zone-enabled" name="enabled">
              <option value="on" {...(zone.enabled ? { selected: true } : {})}>Yes — customers can choose this zone</option>
              <option value="off">No — hidden from customers</option>
            </select>
          </div>
          <button class="btn btn-primary" type="submit">Save changes</button>
        </form>
      </StaffPage>
    );
  });

  app.post("/staff/juice/delivery", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const body = await c.req.parseBody() as Record<string, string>;
    const parsedZone = parseZoneBody(body);
    if (parsedZone.errors.length) {
      return c.html(
        <StaffPage title="Error">
          <div class="panel notice bad">
            <strong>Could not save the zone:</strong>
            <ul>{parsedZone.errors.map((e) => <li>{e}</li>)}</ul>
          </div>
          <p><a class="btn btn-ghost" href="/staff/juice/delivery">Back</a></p>
        </StaffPage>,
        400
      );
    }
    const { name, description, feeMinor, minOrderMinor, enabled, sortOrder } = parsedZone;

    try {
      tx(() => {
        run(
          `INSERT INTO delivery_zones(name, description, fee_minor, min_order_minor, enabled, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
          [name, description, feeMinor, minOrderMinor, enabled ? 1 : 0, sortOrder, new Date().toISOString(), new Date().toISOString()],
        );
        const id = queryOne("SELECT last_insert_rowid() AS id")!.id as number;
        run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)", [u.id, "delivery_zone.create", "delivery_zones", String(id), JSON.stringify({ name, fee: feeMinor, enabled })]);
      });
    } catch (e) {
      console.error("[juice] delivery zone create error:", e);
      return c.html(
        <StaffPage title="Error">
          <div class="panel notice bad">Could not add zone.</div>
          <p><a class="btn btn-ghost" href="/staff/juice/delivery">Back</a></p>
        </StaffPage>,
        500
      );
    }

    return c.redirect("/staff/juice/delivery");
  });

  app.post("/staff/juice/delivery/:id", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || !deliveryZoneById(id)) return c.text("Zone not found", 404);
    const body = await c.req.parseBody() as Record<string, string>;
    const parsedZone = parseZoneBody(body);
    if (parsedZone.errors.length) {
      return c.html(
        <StaffPage title="Error">
          <div class="panel notice bad">
            <strong>Could not save the zone:</strong>
            <ul>{parsedZone.errors.map((e) => <li>{e}</li>)}</ul>
          </div>
          <p><a class="btn btn-ghost" href={`/staff/juice/delivery/${id}`}>Back</a></p>
        </StaffPage>,
        400
      );
    }
    const { name, description, feeMinor, minOrderMinor, enabled, sortOrder } = parsedZone;

    try {
      tx(() => {
        run(
          `UPDATE delivery_zones SET name=?, description=?, fee_minor=?, min_order_minor=?, enabled=?, sort_order=?, updated_at=? WHERE id=?`,
          [name, description, feeMinor, minOrderMinor, enabled ? 1 : 0, sortOrder, new Date().toISOString(), id],
        );
        run("INSERT INTO audit_log(actor_user, action, entity, entity_id, detail) VALUES (?,?,?,?,?)", [u.id, "delivery_zone.update", "delivery_zones", String(id), JSON.stringify({ name, fee: feeMinor, enabled })]);
      });
    } catch (e) {
      console.error("[juice] delivery zone update error:", e);
      return c.html(
        <StaffPage title="Error">
          <div class="panel notice bad">Could not save zone.</div>
          <p><a class="btn btn-ghost" href={`/staff/juice/delivery/${id}`}>Back</a></p>
        </StaffPage>,
        500
      );
    }

    return c.redirect("/staff/juice/delivery");
  });

  // ---------- REVIEWS ----------
  app.get("/staff/juice/reviews", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/reviews");
    if (!canManageOrders(u)) return c.text("Not permitted", 403);

    const statusFilter = c.req.query("status") || "pending";
    const reviews = queryAll(
      `SELECT r.id, r.rating, r.body, r.author_name, r.is_verified, r.status, r.rejection_note AS rejectionNote, r.created_at, p.name AS product_name
         FROM reviews r
         LEFT JOIN products p ON p.id = r.product_id
        WHERE ? IS NULL OR r.status = ?
        ORDER BY r.created_at DESC`,
      [statusFilter === "all" ? null : statusFilter, statusFilter === "all" ? null : statusFilter]) as unknown as StaffReviewRow[];

    const pendingCount = queryOne(`SELECT COUNT(*) AS n FROM reviews WHERE status='pending'`)!.n as number;

    return c.html(
      <StaffPage title="Reviews — Juice Bar" >

        <h1>Customer reviews</h1>
        <div class="filters-row">
          <a class={`filter-link${statusFilter === "all" ? " active" : ""}`} href="/staff/juice/reviews?status=all">All</a>
          <a class={`filter-link${statusFilter === "pending" ? " active" : ""}`} href="/staff/juice/reviews?status=pending">Pending ({pendingCount})</a>
          <a class={`filter-link${statusFilter === "approved" ? " active" : ""}`} href="/staff/juice/reviews?status=approved">Approved</a>
          <a class={`filter-link${statusFilter === "rejected" ? " active" : ""}`} href="/staff/juice/reviews?status=rejected">Rejected</a>
        </div>

        <div class="panel">
          {reviews.length === 0 ? (
            <p class="muted">No reviews to show.</p>
          ) : (
            <ul class="review-list review-list-full">
              {reviews.map((r) => (
                <li key={r.id}>
                  <div class="review-header">
                    <div class="review-stars">{stars(r.rating)}</div>
                    <div class="review-meta">
                      <span class="review-author">{r.author_name}</span>
                      {r.product_name ? <span class="review-product">· {r.product_name}</span> : null}
                      {r.is_verified ? <span class="verified-tag">Verified purchase</span> : null}
                      <span class="review-time muted small">{new Date(r.created_at).toLocaleString("en-KE")}</span>
                      <span class={`review-status tag ${r.status}`}>{r.status}</span>
                    </div>
                  </div>
                  <p class="review-text">{r.body}</p>
                  {r.rejectionNote && <p class="muted small">Rejection note: {r.rejectionNote}</p>}
                  <div class="review-actions">
                    {r.status === "pending" && canManageOrders(u) && (
                      <>
                        <form method="post" action="/staff/juice/reviews/moderate" style={{ display: "inline", marginRight: "8px" }}>
                          <input type="hidden" name="reviewId" value={String(r.id)} />
                          <input type="hidden" name="status" value="approved" />
                          <button class="btn btn-sm btn-ghost" type="submit">Approve</button>
                        </form>
                        <form method="post" action="/staff/juice/reviews/moderate" style={{ display: "inline" }}>
                          <input type="hidden" name="reviewId" value={String(r.id)} />
                          <input type="hidden" name="status" value="rejected" />
                          <input type="text" name="note" placeholder="Reason for rejection" style={{ width: "160px" }} />
                          <button class="btn btn-sm btn-danger" type="submit">Reject</button>
                        </form>
                      </>
                    )}
                    {r.status === "rejected" && canManageOrders(u) && (
                      <form method="post" action="/staff/juice/reviews/moderate" style={{ display: "inline" }}>
                        <input type="hidden" name="reviewId" value={String(r.id)} />
                        <input type="hidden" name="status" value="approved" />
                        <button class="btn btn-sm btn-ghost" type="submit">Re-approve</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </StaffPage>
    );
  });

  app.post("/staff/juice/reviews/moderate", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    if (!canManageOrders(u)) return c.text("Not permitted", 403);

    const body = await c.req.parseBody() as Record<string, string>;
    const reviewId = Number(body.reviewId);
    const status = body.status as "approved" | "rejected";
    const note = body.note || "";

    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return c.html(
        <StaffPage title="Moderation error">
          <div class="panel notice bad">Invalid review reference.</div>
          <p><a class="btn btn-ghost" href="/staff/juice/reviews">Back</a></p>
        </StaffPage>,
        400
      );
    }
    if (status !== "approved" && status !== "rejected") {
      return c.html(
        <StaffPage title="Moderation error">
          <div class="panel notice bad">Invalid moderation action — only approve or reject is allowed.</div>
          <p><a class="btn btn-ghost" href="/staff/juice/reviews">Back</a></p>
        </StaffPage>,
        400
      );
    }

    const result = moderateReview(reviewId, status, u.id, note);
    if (!result.ok) {
      return c.html(
        <StaffPage title="Moderation error">
          <div class="panel notice bad">{result.msg}</div>
          <p><a class="btn btn-ghost" href="/staff/juice/reviews">Back</a></p>
        </StaffPage>,
        400
      );
    }
    return c.redirect("/staff/juice/reviews?status=" + (status === "approved" ? "pending" : "rejected"));
  });

  // ---------- CATERING ENQUIRIES ----------
  app.get("/staff/juice/catering", (c) => {
    const u = staff(c, config, "reports");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/catering");
    if (!canManageOrders(u)) return c.text("Not permitted", 403);

    const statusFilter = c.req.query("status") || "open";
    const all = recentCateringEnquiries(200);
    const enquiries = statusFilter === "all"
      ? all
      : statusFilter === "open"
        ? all.filter((e) => e.status === "new" || e.status === "quoted" || e.status === "confirmed")
        : all.filter((e) => e.status === statusFilter);

    const counts = {
      open: all.filter((e) => e.status === "new" || e.status === "quoted" || e.status === "confirmed").length,
      new: all.filter((e) => e.status === "new").length,
      quoted: all.filter((e) => e.status === "quoted").length,
      confirmed: all.filter((e) => e.status === "confirmed").length,
      declined: all.filter((e) => e.status === "declined").length,
      completed: all.filter((e) => e.status === "completed").length,
    };

    return c.html(
      <StaffPage title="Catering enquiries — Juice Bar" active="/staff/juice/catering">
        <h1>Catering enquiries</h1>
        <p class="muted">Enquiries submitted from the public catering page. Nothing here is a confirmed booking until you quote and confirm it.</p>

        <div class="filters-row">
          <a class={`filter-link${statusFilter === "open" ? " active" : ""}`} href="/staff/juice/catering?status=open">Open ({counts.open})</a>
          <a class={`filter-link${statusFilter === "new" ? " active" : ""}`} href="/staff/juice/catering?status=new">New ({counts.new})</a>
          <a class={`filter-link${statusFilter === "quoted" ? " active" : ""}`} href="/staff/juice/catering?status=quoted">Quoted ({counts.quoted})</a>
          <a class={`filter-link${statusFilter === "confirmed" ? " active" : ""}`} href="/staff/juice/catering?status=confirmed">Confirmed ({counts.confirmed})</a>
          <a class={`filter-link${statusFilter === "completed" ? " active" : ""}`} href="/staff/juice/catering?status=completed">Completed ({counts.completed})</a>
          <a class={`filter-link${statusFilter === "declined" ? " active" : ""}`} href="/staff/juice/catering?status=declined">Declined ({counts.declined})</a>
          <a class={`filter-link${statusFilter === "all" ? " active" : ""}`} href="/staff/juice/catering?status=all">All</a>
        </div>

        <div class="panel">
          {enquiries.length === 0 ? (
            <p class="muted">No catering enquiries with this status. New enquiries submitted on the website appear here immediately.</p>
          ) : (
            <ul class="review-list review-list-full">
              {enquiries.map((e) => (
                <li key={e.id}>
                  <div class="review-header">
                    <span class="review-author">{e.reference}</span>
                    <span class={`review-status tag ${e.status === "confirmed" || e.status === "completed" ? "ok" : e.status === "declined" ? "danger" : "warn"}`}>{e.status}</span>
                    <span class="review-time muted small">{new Date(e.createdAt).toLocaleString("en-KE")}</span>
                  </div>
                  <p class="review-text">
                    <strong>{e.contactName}</strong> · <a class="phone-link" href={`tel:${e.contactPhone}`}>{e.contactPhone}</a>
                    {e.contactEmail ? ` · ${e.contactEmail}` : ""}
                  </p>
                  <p class="review-meta">
                    {e.eventType} · {e.guestCount} guest{e.guestCount === 1 ? "" : "s"}
                    {e.eventDate ? ` · ${e.eventDate}` : ""}
                  </p>
                  {e.itemsRequested ? <p class="review-product">Requested: {e.itemsRequested}</p> : null}
                  {e.notes ? <p class="muted small">{e.notes}</p> : null}
                  <div class="review-actions">
                    <form method="post" action="/staff/juice/catering/status" style={{ display: "inline" }}>
                      <input type="hidden" name="reference" value={e.reference} />
                      <select name="status" aria-label={`Status for ${e.reference}`}>
                        {CATERING_STATUSES.map((s) => (
                          <option value={s} {...(s === e.status ? { selected: true } : {})}>{s}</option>
                        ))}
                      </select>
                      <input type="text" name="note" placeholder="Note (optional)" style={{ width: "150px" }} />
                      <button class="btn btn-sm btn-ghost" type="submit">Update</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </StaffPage>
    );
  });

  app.post("/staff/juice/catering/status", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    if (!canManageOrders(u)) return c.text("Not permitted", 403);

    const body = await c.req.parseBody() as Record<string, string>;
    const reference = (body.reference ?? "").trim();
    const status = body.status as CateringStatus;
    const note = (body.note ?? "").trim();

    if (!reference) return c.text("Missing enquiry reference", 400);
    if (!CATERING_STATUSES.includes(status)) return c.text("Unknown status", 400);

    const result = updateCateringEnquiryStatus(reference, status, u.id, note);
    if (!result.ok) {
      return c.html(
        <StaffPage title="Catering update failed">
          <div class="panel notice bad">{result.msg}</div>
          <p><a class="btn btn-ghost" href="/staff/juice/catering">Back</a></p>
        </StaffPage>,
        400
      );
    }
    return c.redirect("/staff/juice/catering?status=" + (status === "new" ? "open" : status));
  });

  // ---------- SETTINGS ----------
  app.get("/staff/juice/settings", (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.redirect("/staff/login?next=/staff/juice/settings");
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const settings = [
      { key: "business_name", label: "Business name", value: businessSetting("business_name") },
      { key: "tagline", label: "Tagline", value: businessSetting("tagline") },
      { key: "contact_phone", label: "Contact phone", value: businessSetting("contact_phone") },
      { key: "contact_email", label: "Contact email", value: businessSetting("contact_email") },
      { key: "address_line", label: "Address", value: businessSetting("address_line") },
      { key: "instagram_url", label: "Instagram URL", value: businessSetting("instagram_url") },
      { key: "facebook_url", label: "Facebook URL", value: businessSetting("facebook_url") },
      { key: "opening_hours", label: "Opening hours (HTML)", value: businessSetting("opening_hours") },
      { key: "about_html", label: "About section (HTML)", value: businessSetting("about_html") },
      { key: "footer_policy_note", label: "Footer policy note", value: businessSetting("footer_policy_note") },
      { key: "hero_headline", label: "Homepage headline", value: businessSetting("hero_headline") },
      { key: "hero_subhead", label: "Homepage subheadline", value: businessSetting("hero_subhead") },
      { key: "hero_cta", label: "Homepage CTA button text", value: businessSetting("hero_cta") },
    ];

    return c.html(
      <StaffPage title="Settings — Juice Bar" >

        <h1>Storefront settings</h1>
        <p class="muted">Update the customer-facing content. These are public — only edit what you're happy customers seeing.</p>

        <div class="panel">
          <form method="post" action="/staff/juice/settings/save">
            {settings.map((s) => (
              <div class="field" key={s.key} style={{ marginBottom: "16px" }}>
                <label for={`setting-${s.key}`}>{s.label}</label>
                <textarea id={`setting-${s.key}`} name={s.key} data-key={s.key} rows={s.key === "about_html" || s.key === "opening_hours" || s.key === "footer_policy_note" ? 4 : 2}>{s.value}</textarea>
              </div>
            ))}
            <input type="hidden" name="staffId" value={String(u.id)} />
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Save all settings</button>
            </div>
          </form>
        </div>
      </StaffPage>
    );
  });

  app.post("/staff/juice/settings/save", async (c) => {
    const u = staff(c, config, "manage");
    if (!u) return c.text("Forbidden", 403);
    if (!canManageProducts(u)) return c.text("Not permitted", 403);

    const body = await c.req.parseBody() as Record<string, string>;

    // Each field is posted under its own name; fall back to the stored value
    // when a field was left untouched.
    const fields = ["business_name", "tagline", "contact_phone", "contact_email", "address_line", "instagram_url", "facebook_url", "opening_hours", "about_html", "footer_policy_note", "hero_headline", "hero_subhead", "hero_cta"];
    const updated: Record<string, string> = {};
    for (const k of fields) {
      const posted = body[k];
      updated[k] = typeof posted === "string" ? posted : businessSetting(k);
    }

    let saved = 0;
    for (const [key, value] of Object.entries(updated)) {
      const res = updateBusinessSetting(key, value, u.id);
      if (res.ok) saved++;
    }

    return c.html(
      <StaffPage title="Settings saved">
        <div class="panel notice ok">
          <h1>Settings saved</h1>
          <p>{saved} setting{saved !== 1 ? "s" : ""} updated.</p>
          <p><a class="btn btn-primary" href="/staff/juice/settings">Back to settings</a></p>
        </div>
      </StaffPage>
    );
  });

  return app;
}

// ---------- helpers ----------

interface SalesSummary {
  weekRevenueMinor: number;
  weekOrders: number;
  avgOrderMinor: number;
  unitsSold: number;
  deliverySharePct: number;
  openCatering: number;
  topProducts: { name: string; qty: number; revenueMinor: number }[];
  totalProducts: number;
  availableProducts: number;
  unavailableProducts: number;
  unavailableList: { id: number; name: string; categoryName: string }[];
}

/**
 * Derive the sales + availability summary directly from the order tables so the
 * dashboard can never show numbers that disagree with the underlying orders.
 * Cancelled and failed orders are excluded from revenue.
 */
function buildSalesSummary(): SalesSummary {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const counted = "('new','accepted','preparing','ready_for_pickup','ready_for_dispatch','out_for_delivery','delivered')";

  const weekRow = queryOne(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_minor), 0) AS revenue,
            COALESCE(SUM(CASE WHEN type = 'delivery' THEN 1 ELSE 0 END), 0) AS deliveries
       FROM juice_orders
      WHERE created_at >= ? AND status IN ${counted}`,
    [weekAgo],
  )!;

  const weekOrders = Number(weekRow.orders ?? 0);
  const weekRevenueMinor = Number(weekRow.revenue ?? 0);
  const deliveries = Number(weekRow.deliveries ?? 0);

  const unitsRow = queryOne(
    `SELECT COALESCE(SUM(ji.qty), 0) AS units
       FROM juice_order_items ji
       JOIN juice_orders jo ON jo.id = ji.juice_order_id
      WHERE jo.created_at >= ? AND jo.status IN ${counted}`,
    [weekAgo],
  )!;

  // NB: juice_order_items stores product_id (not a denormalised product name),
  // so the product title is joined in from `products`.
  const topRows = queryAll(
    `SELECT p.name AS name, SUM(ji.qty) AS qty, SUM(ji.line_total_minor) AS revenueMinor
       FROM juice_order_items ji
       JOIN juice_orders jo ON jo.id = ji.juice_order_id
       JOIN products p ON p.id = ji.product_id
      WHERE jo.created_at >= ? AND jo.status IN ${counted}
      GROUP BY p.id, p.name
      ORDER BY qty DESC, revenueMinor DESC
      LIMIT 5`,
    [weekAgo],
  );

  const productRows = queryAll(
    `SELECT p.id, p.name, p.available, COALESCE(pc.name, '') AS categoryName
       FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id`,
  );

  const openCatering = Number(
    queryOne(`SELECT COUNT(*) AS n FROM catering_enquiries WHERE status IN ('new','quoted','confirmed')`)?.n ?? 0,
  );

  return {
    weekRevenueMinor,
    weekOrders,
    avgOrderMinor: weekOrders > 0 ? Math.round(weekRevenueMinor / weekOrders) : 0,
    unitsSold: Number(unitsRow.units ?? 0),
    deliverySharePct: weekOrders > 0 ? Math.round((deliveries / weekOrders) * 100) : 0,
    openCatering,
    topProducts: topRows.map((r) => ({
      name: String(r.name),
      qty: Number(r.qty ?? 0),
      revenueMinor: Number(r.revenueMinor ?? 0),
    })),
    totalProducts: productRows.length,
    availableProducts: productRows.filter((p) => Number(p.available) === 1).length,
    unavailableProducts: productRows.filter((p) => Number(p.available) !== 1).length,
    unavailableList: productRows
      .filter((p) => Number(p.available) !== 1)
      .map((p) => ({ id: Number(p.id), name: String(p.name), categoryName: String(p.categoryName) })),
  };
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

function statusTagClass(status: string): string {
  return {
    new: "warn",
    accepted: "ok",
    preparing: "ok",
    ready_for_pickup: "ok",
    ready_for_dispatch: "ok",
    out_for_delivery: "ok",
    delivered: "ok",
    cancelled: "danger",
    failed: "danger",
  }[status] ?? "";
}

function stars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function statusTimeline(current: string): { label: string; done: boolean; current: boolean; time?: string }[] {
  const steps: { label: string; key: string }[] = [
    { label: "Order received", key: "new" },
    { label: "Accepted", key: "accepted" },
    { label: "Preparing", key: "preparing" },
    { label: "Ready", key: "ready_for_pickup" },
    { label: "Ready to dispatch", key: "ready_for_dispatch" },
    { label: "Out for delivery", key: "out_for_delivery" },
    { label: "Delivered", key: "delivered" },
  ];
  const idx = steps.findIndex((s) => s.key === current);
  const now = new Date().toISOString();
  return steps.map((step, i) => {
    const done = i < (idx >= 0 ? idx : steps.length);
    const currentFlag = i === (idx >= 0 ? idx : steps.length - 1) && idx >= 0;
    return { label: step.label, done, current: currentFlag, time: done && step.key !== "new" ? now : undefined };
  });
}

/** Statuses an order can legally move to next (mirrors the server-side transition map). */
function nextStatusesFor(status: string, type: "pickup" | "delivery"): JuiceOrderStatus[] {
  const map: Record<string, JuiceOrderStatus[]> = {
    new: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready_for_pickup", "ready_for_dispatch", "cancelled"],
    ready_for_pickup: ["out_for_delivery", "delivered", "cancelled"],
    ready_for_dispatch: ["out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered", "failed"],
    delivered: [],
    cancelled: [],
    failed: ["cancelled"],
  };
  const allowed = map[status] ?? [];
  // Dispatch-only statuses are meaningless for pickup orders.
  if (type === "pickup") return allowed.filter((s) => s !== "ready_for_dispatch" && s !== "out_for_delivery");
  return allowed;
}

function statusLabelFor(status: string): string {
  return {
    new: "New — awaiting confirmation",
    accepted: "Accepted",
    preparing: "Being prepared",
    ready_for_pickup: "Ready for pickup",
    ready_for_dispatch: "Ready to dispatch",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered",
    cancelled: "Cancelled",
    failed: "Failed",
  }[status] ?? status;
}

// ---------- forms ----------

interface ProductFormValues {
  name: string;
  sku: string;
  categoryId: string;
  price: string;
  description: string;
  ingredientNote: string;
  sortOrder: string;
  sizesJson: string;
  addonsJson: string;
  available: boolean;
  featured: boolean;
  bestseller: boolean;
}

function productFormValues(p: Product | null): ProductFormValues {
  return {
    name: p?.name ?? "",
    sku: p?.sku ?? "",
    categoryId: p ? String(p.categoryId) : "",
    price: p ? (p.priceMinor / 100).toFixed(2) : "",
    description: p?.description ?? "",
    ingredientNote: p?.ingredientNote ?? "",
    sortOrder: p ? String(p.sortOrder) : "0",
    sizesJson: p && p.sizes.length ? JSON.stringify(p.sizes.map((s) => ({ label: s.label, price_minor: s.priceMinor })), null, 1) : "",
    addonsJson: p && p.addons.length ? JSON.stringify(p.addons.map((a) => ({ name: a.name, price_minor: a.priceMinor })), null, 1) : "",
    available: p ? p.available : true,
    featured: p ? p.featured : false,
    bestseller: p ? p.bestseller : false,
  };
}

function valuesFromBody(body: Record<string, string>): ProductFormValues {
  return {
    name: (body.name ?? "").trim(),
    sku: (body.sku ?? "").trim(),
    categoryId: body.categoryId ?? "",
    price: (body.price ?? "").trim(),
    description: body.description ?? "",
    ingredientNote: body.ingredientNote ?? "",
    sortOrder: (body.sortOrder ?? "0").trim(),
    sizesJson: body.sizesJson ?? "",
    addonsJson: body.addonsJson ?? "",
    available: body.available === "on",
    featured: body.featured === "on",
    bestseller: body.bestseller === "on",
  };
}

/** Validate and normalise the optional sizes/add-ons JSON columns.
 * Schema format: sizes [{label, price_minor}], addons [{name, price_minor}] (see toProduct in juice.ts). */
function parseAddonsOrSizesJson(raw: string, kind: "sizes" | "addons"): { ok: true; value: string | null } | { ok: false; msg: string } {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  const what = kind === "sizes" ? "Sizes" : "Add-ons";
  const key = kind === "sizes" ? "label" : "name";
  let parsed: unknown;
  try { parsed = JSON.parse(s); } catch { return { ok: false, msg: `${what} must be valid JSON (or leave the field blank).` }; }
  if (!Array.isArray(parsed)) return { ok: false, msg: `${what} must be a JSON array (or leave the field blank).` };
  if (parsed.length > 20) return { ok: false, msg: `Too many ${what.toLowerCase()} — maximum 20.` };
  const out: Array<Record<string, unknown>> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, msg: `Each ${what.toLowerCase().slice(0, -1)} must be a JSON object like {"${key}": "…", "price_minor": 0}.` };
    const rec = entry as Record<string, unknown>;
    const label = typeof rec[key] === "string" ? (rec[key] as string).trim() : "";
    if (!label) return { ok: false, msg: `Each ${what.toLowerCase().slice(0, -1)} needs a non-empty “${key}”.` };
    const price = Number(rec.price_minor ?? 0);
    if (!Number.isInteger(price) || price < 0 || price > 1_000_000) {
      return { ok: false, msg: `“${label}” has an invalid price — price_minor must be a whole number of KES minor units between 0 and 1,000,000 (100 = KSh 1).` };
    }
    out.push(kind === "sizes" ? { label: label.slice(0, 40), price_minor: price } : { name: label.slice(0, 60), price_minor: price });
  }
  return { ok: true, value: JSON.stringify(out) };
}

/** Shared validation for delivery-zone create/edit forms. Fees are posted in KES and stored in minor units. */
function parseZoneBody(body: Record<string, string>): {
  errors: string[];
  name: string;
  description: string;
  feeMinor: number;
  minOrderMinor: number;
  enabled: boolean;
  sortOrder: number;
} {
  const errors: string[] = [];
  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim().slice(0, 300);
  if (!name) errors.push("Zone name is required.");
  else if (name.length > 80) errors.push("Zone name must be 80 characters or fewer.");

  const feeRaw = (body.fee ?? "").trim();
  let feeMinor = NaN;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(feeRaw)) errors.push("Delivery fee must be a valid amount in KES (0 or more), e.g. 50.");
  else feeMinor = Math.round(parseFloat(feeRaw) * 100);

  const minRaw = (body.minOrder ?? "").trim();
  let minOrderMinor = NaN;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(minRaw)) errors.push("Minimum order must be a valid amount in KES (0 or more), e.g. 300.");
  else minOrderMinor = Math.round(parseFloat(minRaw) * 100);

  const sortRaw = (body.sortOrder ?? "0").trim() || "0";
  let sortOrder = NaN;
  if (!/^\d{1,5}$/.test(sortRaw)) errors.push("Sort order must be a whole number (0–99999).");
  else sortOrder = Number(sortRaw);

  const enabled = body.enabled !== "off";
  return { errors, name, description, feeMinor, minOrderMinor, enabled, sortOrder };
}

function productFormPage(c: Context, product: Product | null, categories: ProductCategory[], errors: string[], values?: ProductFormValues, status?: 400) {
  const submitUrl = product ? `/staff/juice/products/${product.id}` : "/staff/juice/products";
  const submitLabel = product ? "Save changes" : "Add product";
  const html = (
    <StaffPage title={product ? `Edit ${product.name} — Juice Bar` : "New product — Juice Bar"} active="/staff/juice/products">

      <h1>{product ? `Edit product — ${product.name}` : "Add product"}</h1>
      <ProductForm categories={categories} product={product} submitUrl={submitUrl} submitLabel={submitLabel} errors={errors} values={values} />
    </StaffPage>
  );
  return status ? c.html(html, status) : c.html(html);
}

function ProductForm({ categories, product, submitUrl, submitLabel, errors, values }: {
  categories: ProductCategory[];
  product: Product | null;
  submitUrl: string;
  submitLabel: string;
  errors?: string[];
  values?: ProductFormValues;
}) {
  const v = values ?? productFormValues(product);
  return (
    <form method="post" action={submitUrl} class="panel">
      {errors && errors.length ? (
        <div class="notice bad" role="alert">
          <strong>Please fix the following before saving:</strong>
          <ul>{errors.map((e) => <li>{e}</li>)}</ul>
        </div>
      ) : null}
      {product ? <input type="hidden" name="id" value={String(product.id)} /> : null}

      <div class="field">
        <label for="pf-name">Name *</label>
        <input id="pf-name" name="name" type="text" required maxLength={120} value={v.name} placeholder="e.g. Mango Sunshine Smoothie" />
      </div>
      <div class="field">
        <label for="pf-category">Category *</label>
        <select id="pf-category" name="categoryId" required>
          <option value="" {...(v.categoryId ? {} : { selected: true })}>Choose a category…</option>
          {categories.map((cat) => (
            <option value={String(cat.id)} {...(v.categoryId === String(cat.id) ? { selected: true } : {})}>{cat.name}</option>
          ))}
        </select>
      </div>
      <div class="field">
        <label for="pf-price">Price (KES) *</label>
        <input id="pf-price" name="price" type="text" inputmode="decimal" required placeholder="e.g. 150" value={v.price} />
        <p class="muted small">Standard size price. Use the Sizes field below for size variants.</p>
      </div>
      <div class="field">
        <label for="pf-sku">SKU (optional — auto-generated if left blank)</label>
        <input id="pf-sku" name="sku" type="text" maxLength={40} value={v.sku} placeholder="e.g. MNM-MS-001" />
      </div>
      <div class="field">
        <label for="pf-description">Description</label>
        <textarea id="pf-description" name="description" rows={3} placeholder="What makes it delicious">{v.description}</textarea>
      </div>
      <div class="field">
        <label for="pf-ingredientNote">Ingredients / allergen note</label>
        <textarea id="pf-ingredientNote" name="ingredientNote" rows={2} placeholder="e.g. Contains dairy. Prepared near nuts.">{v.ingredientNote}</textarea>
      </div>
      <div class="field">
        <label for="pf-sizes">Sizes (JSON, optional)</label>
        <textarea id="pf-sizes" name="sizesJson" rows={3} placeholder={'[{"label":"Large","price_minor":5000}]'}>{v.sizesJson}</textarea>
        <p class="muted small">Leave blank for a single standard size. price_minor is KES minor units (100 = KSh 1).</p>
      </div>
      <div class="field">
        <label for="pf-addons">Add-ons (JSON, optional)</label>
        <textarea id="pf-addons" name="addonsJson" rows={3} placeholder={'[{"name":"Extra avocado","price_minor":3000}]'}>{v.addonsJson}</textarea>
        <p class="muted small">Leave blank if this drink has no extras.</p>
      </div>
      <div class="field">
        <label for="pf-sortOrder">Sort order (lower appears first)</label>
        <input id="pf-sortOrder" name="sortOrder" type="number" min="0" max="99999" value={v.sortOrder} />
      </div>
      <div class="field">
        <label><input type="checkbox" name="available" {...(v.available ? { checked: true } : {})} /> Available for sale</label>
        <label><input type="checkbox" name="featured" {...(v.featured ? { checked: true } : {})} /> Feature on the homepage</label>
        <label><input type="checkbox" name="bestseller" {...(v.bestseller ? { checked: true } : {})} /> Mark as bestseller</label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">{submitLabel}</button>
        <a class="btn btn-ghost" href="/staff/juice/products">Cancel</a>
      </div>
    </form>
  );
}
