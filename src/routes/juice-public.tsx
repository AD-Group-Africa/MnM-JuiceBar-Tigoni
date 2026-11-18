/** MnM Juice Bar customer storefront: homepage, catalogue, product detail, cart, checkout.
 * Coexists with the ticketing module — this is the primary customer-facing business.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppConfig } from "../config.ts";
import {
  allCategories, featuredProducts, bestsellerProducts, allProducts, productById,
  productsInCategory, approvedReviewsForProduct, averageRating, juiceOrderByRef, searchProducts, cartSubtotal, computeJuiceOrderTotals, enabledDeliveryZones,
  createJuiceOrder, businessSetting, createCateringEnquiry, CATERING_EVENT_TYPES,
  issueJuiceOrderToken, checkJuiceOrderAccess,
} from "../juice.ts";
import { formatMinor } from "../money.ts";
import { queryOne } from "../db.ts";
import { stateChangeOriginAllowed } from "../auth.ts";
import { rateLimit } from "../ratelimit.ts";
import { normalisePhoneKenya } from "../orders.ts";
import { CUSTOMER_COOKIE, getCustomerBySession, linkJuiceOrderToCustomer } from "../customers.ts";
import { Page } from "../views/layout.tsx";

const HOME_MARQUEE = ["Fresh fruit", "No concentrates", "Pressed to order", "Tigoni, Limuru", "Pickup & delivery", "MnM Tickets"];

export function juicePublicRoutes(config: AppConfig): Hono {
  const app = new Hono();

  // Friendly alias — customers often type /juice for the storefront.
  app.get("/juice", (c) => c.redirect("/menu", 301));

  // ---------- HOME ----------
  app.get("/", (c) => {
    const categories = allCategories();
    const featured = featuredProducts(6);
    const heroHeadline = businessSetting("hero_headline") || "Tigoni's fresh juice bar. Handmade daily.";
    const heroSubhead = businessSetting("hero_subhead") || "Fresh juices, smoothies, fruit blends and snacks — pressed fresh at M&M Juice Bar Tigoni.";
    const address = businessSetting("address_line");
    const phone = businessSetting("contact_phone");
    const hours = businessSetting("opening_hours");
    const aboutBlurb = businessSetting("about_html");
    const productCount = allProducts({ available: true }).length;

    // Split the owner-editable headline at its first full stop so the second
    // sentence can carry the italic brand accent without hard-coding copy.
    const split = heroHeadline.match(/^(.+?\.)\s*(.*)$/);
    const headlineMain = split?.[1] ?? heroHeadline;
    const headlineAccent = split?.[2] || "Handmade daily.";

    const tiles = (featured.filter((p) => p.primaryImage).length >= 2 ? featured.filter((p) => p.primaryImage) : featured).slice(0, 3);

    // Next event for the ticketing band (degrades to a plain CTA if none).
    let nextEvent: Record<string, unknown> | undefined;
    try {
      nextEvent = queryOne(
        `SELECT title, slug, starts_at, venue_name FROM events
          WHERE status='on_sale' AND starts_at > ?
          ORDER BY starts_at ASC LIMIT 1`,
        [new Date().toISOString()],
      );
    } catch { nextEvent = undefined; }

    return c.html(
      <Page title="Fresh juices, smoothies & snacks in Tigoni" active="/">
        {/* HERO */}
        <section class="home-hero">
          <div class="home-hero-copy">
            <p class="kicker">Tigoni, Limuru · Fresh every day</p>
            <h1 class="home-title">{headlineMain}<br /><em>{headlineAccent}</em></h1>
            <p class="home-sub">{heroSubhead}</p>
            <div class="home-actions">
              <a class="btn btn-primary btn-lg" href="/menu">Order now</a>
              <a class="btn btn-ghost btn-lg" href="/events">Event tickets</a>
            </div>
            <div class="home-proof">
              <span class="home-proof-item"><span class="home-proof-dot" aria-hidden="true" />Pressed to order</span>
              <span class="home-proof-item"><span class="home-proof-dot" aria-hidden="true" />{productCount} drinks &amp; snacks</span>
              <span class="home-proof-item"><span class="home-proof-dot" aria-hidden="true" />Pickup &amp; delivery</span>
            </div>
          </div>

          <div class="home-visual">
            <div class="home-visual-grid">
              {tiles.map((p, i) => (
                <div class={`home-shot${i === 0 ? " tall" : ""}`}>
                  {p.primaryImage ? (
                    <img src={p.primaryImage} alt={p.name} loading={i === 0 ? "eager" : "lazy"} />
                  ) : (
                    <div class="product-card-initials">{initialsFor(p.name)}</div>
                  )}
                  <span class="home-shot-label">{p.name}</span>
                </div>
              ))}
            </div>
            <div class="home-badge" aria-hidden="true"><span>Made fresh<strong>Daily</strong></span></div>
            <p class="home-visual-note">Sample illustrations — owner photography to follow.</p>
          </div>
        </section>

        {/* RIBBON */}
        <div class="home-marquee" aria-hidden="true">
          <div class="marquee-track">
            {[0, 1].map(() => HOME_MARQUEE.map((word) => <span>{word}</span>))}
          </div>
        </div>

        {/* CATEGORIES */}
        <section class="section">
          <div class="section-head">
            <div>
              <p class="kicker">Our menu</p>
              <h2>Find your favourite.</h2>
            </div>
            <a class="link-ghost" href="/menu">See everything &rarr;</a>
          </div>
          <div class="cat-index">
            {categories.map((cat) => (
              <a class="cat-index-row" href={`/menu?category=${cat.id}`}>
                <span class="cat-index-num">{String(cat.id).padStart(2, "0")}</span>
                <span class="cat-index-name">
                  {cat.name}
                  <span class="cat-index-desc">{cat.description}</span>
                </span>
                <span class="cat-index-arrow" aria-hidden="true">&rarr;</span>
              </a>
            ))}
          </div>
        </section>

        {/* SIGNATURES */}
        {featured.length > 0 && (
          <section class="section">
            <div class="section-head">
              <div>
                <p class="kicker">Signatures</p>
                <h2>What people order.</h2>
              </div>
              <p class="muted small">Prices confirmed in store. Choose a size and add-ons on any drink.</p>
            </div>
            <div class="product-grid">
              {featured.map((p) => <ProductCard product={p} />)}
            </div>
          </section>
        )}

        {/* TICKETS */}
        <section class="ticket-band">
          <div class="ticket-band-inner">
            <div>
              <p class="kicker kicker-light">MnM Tickets</p>
              <h2>More than<br /><em>a juice bar.</em></h2>
              <p>Live events, authorised ticket sales and a QR ticket the moment you pay. No printing, no queue — just show your phone at the gate.</p>
              <a class="btn btn-primary" href="/events">Browse events</a>
              <div class="ticket-band-meta">
                <span>Instant QR tickets</span>
                <span>Verified once at the gate</span>
              </div>
            </div>
            {nextEvent ? (
              <div class="event-peek">
                <p class="event-peek-label">Next on sale</p>
                <p class="event-peek-date">
                  {new Date(String(nextEvent.starts_at)).toLocaleDateString("en-KE", { day: "numeric", month: "long" })}
                </p>
                <p class="event-peek-title">{String(nextEvent.title)}</p>
                <p class="event-peek-venue">{String(nextEvent.venue_name)}</p>
                <a class="event-peek-link" href={`/events/${String(nextEvent.slug)}`}>View event &amp; tickets &rarr;</a>
              </div>
            ) : (
              <div class="event-peek">
                <p class="event-peek-label">MnM Tickets</p>
                <p class="event-peek-title">Nothing on sale right now.</p>
                <p class="event-peek-venue">New events are announced here and at the bar.</p>
                <a class="event-peek-link" href="/tickets">How ticketing works &rarr;</a>
              </div>
            )}
          </div>
        </section>

        {/* STORY + VISIT */}
        <section class="section">
          <div class="story-split">
            <div class="story-copy">
              <p class="kicker">Our story</p>
              <h2>Fruit first. Always.</h2>
              <div class="about-text">
                <div dangerouslySetInnerHTML={{ __html: aboutBlurb || "<p>A local juice bar in Tigoni, Limuru — fresh drinks and snacks with a friendly neighbourhood feel.</p>" }} />
              </div>
              <p class="story-quote">“No concentrates. No shortcuts. Just fruit, ice and a little patience.”</p>
              <a class="btn btn-secondary" href="/about">Read our story</a>
            </div>
            <div class="visit-list">
              <div class="visit-item">
                <h3>Find us</h3>
                <p>{address || "Tigoni, Limuru, Kenya"}</p>
              </div>
              <div class="visit-item">
                <h3>Call ahead</h3>
                <p><a class="phone-link" href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a></p>
              </div>
              <div class="visit-item">
                <h3>Opening hours</h3>
                <div class="opening-hours" dangerouslySetInnerHTML={{ __html: hours || "Mon–Fri 8am–6pm<br/>Sat 9am–5pm<br/>Sun 10am–4pm" }} />
              </div>
              <div class="visit-item">
                <h3>Catering</h3>
                <p>Feeding a crowd? <a href="/catering">Request a quote</a>.</p>
              </div>
            </div>
          </div>
        </section>
      </Page>,
    );
  });

  // ---------- MENU / CATALOGUE ----------
  app.get("/menu", (c) => {
    const categoryId = c.req.query("category");
    const search = c.req.query("q");
    const categories = allCategories();
    const deliveryZones = enabledDeliveryZones();

    let products: ReturnType<typeof allProducts>;
    let activeCategory: number | null = null;
    let pageTitle = "Full menu — MnM Juice Bar";

    if (search && search.trim()) {
      products = searchProducts(search.trim());
      pageTitle = `Search: "${search.trim()}" — MnM Juice Bar`;
      activeCategory = null;
    } else if (categoryId) {
      const cid = Number(categoryId);
      const cat = categories.find((c) => c.id === cid);
      if (cat) {
        products = productsInCategory(cid, { available: true });
        pageTitle = `${cat.name} — MnM Juice Bar`;
        activeCategory = cid;
      } else {
        products = [];
      }
    } else {
      products = allProducts({ available: true });
    }

    // Group by category
    const grouped: Record<number, { category: typeof categories[0]; items: typeof products }> = {};
    for (const cat of categories) grouped[cat.id] = { category: cat, items: [] as typeof products };
    for (const p of products) {
      const g = grouped[p.categoryId];
      if (g) g.items.push(p);
    }

    return c.html(
      <Page title={pageTitle} active="/menu">
        
        <div class="catalogue-page">
          <div class="menu-hero">
            <p class="kicker">Freshly made</p>
            <h1>The menu</h1>
            <p class="lead">
              {search
                ? `Results for “${search}”.`
                : "Juices, smoothies, fruit blends, milkshakes and snacks. Pick a size, add what you like, and we'll make it when you order."}
            </p>
          </div>

          <div class="menu-tools">
            <form method="get" action="/menu" class="menu-search">
              <input type="search" name="q" placeholder="Search drinks, snacks…" value={search || ""} aria-label="Search the menu" />
              <button type="submit" aria-label="Search">&rarr;</button>
            </form>
            <div class="cart-mini">
              <a class="btn btn-primary" href="/cart">
                <span>Your order</span>
                <span class="cart-count" id="cart-count-mini">0</span>
              </a>
            </div>
          </div>

          <div class="chip-row">
            <a class={!activeCategory ? "chip is-active" : "chip"} href="/menu">All</a>
            {categories.map((cat) => (
              <a class={activeCategory === cat.id ? "chip is-active" : "chip"} href={`/menu?category=${cat.id}`}>{cat.name}</a>
            ))}
          </div>

          {categories.length === 0 ? (
            <div class="panel"><p class="muted">No categories configured. Ask the owner to add menu categories.</p></div>
          ) : (
            <div class="catalogue">
              {categories.map((cat) => {
                const items = grouped[cat.id]?.items ?? [];
                if (items.length === 0 && activeCategory !== null && activeCategory !== cat.id) return null;
                return (
                  <section class="cat-section">
                    <div class="cat-section-head">
                      <h2>
                        <a href={`/menu?category=${cat.id}`} class="cat-link">{cat.name}</a>
                        {activeCategory === cat.id ? <span class="cat-active-tag">Selected</span> : null}
                      </h2>
                      <p class="muted small">{cat.description}</p>
                    </div>
                    {items.length === 0 ? (
                      <div class="empty-cat">
                        <p class="muted">No {cat.name.toLowerCase()} available right now.</p>
                      </div>
                    ) : (
                      <div class="product-grid product-grid-dense">
                        {items.map((p) => (
                          <ProductCard product={p} />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        </Page>,
    );
  });

  // ---------- PRODUCT DETAIL ----------
  app.get("/product/:id", (c) => {
    const id = Number(c.req.param("id"));
    const product = productById(id);
    if (!product || !product.available) {
      return c.html(
        <Page title="Product not available">
          <div class="panel">
            <h1>This drink or snack isn't available</h1>
            <p class="muted">This item isn't on the menu right now — perhaps it sold out or is seasonal.</p>
            <p><a class="btn btn-primary" href="/menu">Back to menu</a></p>
          </div>
          </Page>,
        404,
      );
    }

    const sizes = product.sizes.length > 0 ? product.sizes : null;
    const addons = product.addons.length > 0 ? product.addons : null;
    const reviews = product.id ? approvedReviewsForProduct(product.id) : [];
    const avg = product.id ? averageRating(product.id) : { avg: 0, count: 0 };
    const stars = starsFor(avg.avg);

    return c.html(
      <Page title={`${product.name} — MnM Juice Bar`} active="/menu">
        
        <div class="product-page">
          <div class="product-grid-2">
            {/* IMAGE */}
            <div class="product-main">
              {product.primaryImage ? (
                <img class="product-image" src={product.primaryImage} alt={product.name} />
              ) : (
                <div class="product-image-placeholder">
                  <div class="product-image-initials">{initialsFor(product.name)}</div>
                  <p class="muted small">Photo pending — owner to upload</p>
                </div>
              )}
            </div>

            {/* DETAILS */}
            <div class="product-detail">
              <div class="product-category-tag">{product.category?.name ?? "Drink"}</div>
              <h1>{product.name}</h1>
              <div class="product-badges">
                {product.bestseller ? <span class="tag bestseller">Popular</span> : null}
                {product.featured ? <span class="tag featured">Featured</span> : null}
              </div>
              <p class="product-description">{product.description}</p>

              {product.ingredientNote && (
                <div class="product-ingredients">
                  <span class="ingredient-label">Ingredients / notes</span>
                  <p>{product.ingredientNote}</p>
                </div>
              )}

              <div class="product-price-block">
                <div class="product-price">{formatMinor(product.priceMinor, product.currency)}</div>
                <p class="muted small">Base price · sizes and add-ons below</p>
              </div>

              {/* SIZES */}
              {sizes && (
                <div class="option-block">
                  <span class="option-label">Choose a size</span>
                  <div class="option-radio-group">
                    {sizes.map((s) => (
                      <label class="option-radio">
                        <input type="radio" name="size" value={s.label} data-price={s.priceMinor} />
                        <span class="option-name">{s.label}</span>
                        <span class="option-price">{s.priceMinor === 0 ? "Included" : `+ ${formatMinor(s.priceMinor, product.currency)}`}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* ADD-ONS */}
              {addons && (
                <div class="option-block">
                  <span class="option-label">Add-ons (optional)</span>
                  <div class="option-check-group">
                    {addons.map((a) => (
                      <label class="option-check">
                        <input type="checkbox" name="addon" value={a.name} data-price={a.priceMinor} />
                        <span class="option-name">{a.name}</span>
                        <span class="option-price">{a.priceMinor === 0 ? "Free" : `+ ${formatMinor(a.priceMinor, product.currency)}`}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div class="product-actions">
                <div class="qty-control">
                  <button type="button" class="qty-btn" data-action="decr">&minus;</button>
                  <span class="qty-value" id="qty-display">1</span>
                  <button type="button" class="qty-btn" data-action="incr">+</button>
                </div>
                <button class="btn btn-primary btn-lg btn-block" id="add-to-cart-btn" data-product-id={product.id} data-base-price={product.priceMinor}>
                  Add to order — {formatMinor(product.priceMinor, product.currency)}
                </button>
                <p class="hint">Choose pickup or delivery at checkout. <a class="cart-link" href="/cart">View your order →</a></p>
              </div>

              {stars && (
                <div class="reviews-preview">
                  <div class="stars">{stars}</div>
                  <span class="muted small">({avg.count} review{avg.count !== 1 ? "s" : ""})</span>
                </div>
              )}
            </div>
          </div>
        </div>

        </Page>,
    );
  });

  // ---------- CART (server-rendered, no session needed for simple guest flow) ----------
  app.get("/cart", (c) => {
    const q = new URLSearchParams(c.req.query() as Record<string, string>);
    const itemsJson = q.get("items");
    const deliveryZoneIdRaw = q.get("delivery_zone");
    const deliveryZoneId = deliveryZoneIdRaw ? Number(deliveryZoneIdRaw) : undefined;

    let cartItems: { product: import("../juice.ts").Product; item: { productId: number; qty: number; sizeLabel?: string; sizePriceMinor?: number; addonsChosen?: string[]; addonsPriceMinor?: number } }[] = [];
    let totals = computeJuiceOrderTotals([] as any[], deliveryZoneId);
    let deliveryZones = enabledDeliveryZones();
    let deliveryZone: typeof deliveryZones[0] | null = null;

    if (deliveryZoneId && deliveryZones.length) {
      deliveryZone = deliveryZones.find((z) => z.id === deliveryZoneId) ?? null;
    }

    if (itemsJson) {
      try {
        const parsed = JSON.parse(itemsJson) as any[];
        cartItems = parsed
          .filter((i) => i && typeof i === "object" && i.productId)
          .map((i) => {
            const p = productById(i.productId);
            if (!p) return null;
            return { product: p, item: i };
          })
          .filter(Boolean) as any[];
        totals = computeJuiceOrderTotals(
          cartItems.map((c) => ({
            productId: c.item.productId,
            qty: c.item.qty,
            sizeLabel: c.item.sizeLabel,
            sizePriceMinor: c.item.sizePriceMinor,
            addonsChosen: c.item.addonsChosen,
            addonsPriceMinor: c.item.addonsPriceMinor,
          })),
          deliveryZoneId,
        );
      } catch { cartItems = []; }
    }

    return c.html(
      <Page title="Your order — MnM Juice Bar">
        
        <div class="cart-page">
          <h1>Your order</h1>

          {cartItems.length === 0 ? (
            <div class="panel">
              <p class="muted">Your order is empty.</p>
              <p><a class="btn btn-primary" href="/menu">Browse the menu</a></p>
            </div>
          ) : (
            <div class="cart-layout">
              <div class="cart-items">
                <h2>Items</h2>
                <table class="cart-table">
                  <thead>
                    <tr><th>Drink / snack</th><th>Size</th><th>Add-ons</th><th>Qty</th><th>Line total</th><th></th></tr>
                  </thead>
                  <tbody>
                    {cartItems.map((c) => {
                      const item = c.item;
                      const sizeLabel = item.sizeLabel ?? "Standard";
                      const addons = item.addonsChosen && item.addonsChosen.length ? item.addonsChosen.join(", ") : "";
                      const lineTotal = item.qty * ((item.sizePriceMinor ?? 0) + (item.addonsPriceMinor ?? 0) + c.product.priceMinor);
                      return (
                        <tr key={c.product.id}>
                          <td>
                            <div class="cart-item-name">{c.product.name}</div>
                            <p class="muted small">{c.product.description}</p>
                          </td>
                          <td>{sizeLabel}</td>
                          <td class="small">{addons || "—"}</td>
                          <td class="qty-cell">
                            <button type="button" class="qty-btn-sm" data-action="decr" data-product-id={c.product.id}>&minus;</button>
                            <span class="qty-val">{item.qty}</span>
                            <button type="button" class="qty-btn-sm" data-action="incr" data-product-id={c.product.id}>+</button>
                          </td>
                          <td>{formatMinor(lineTotal, c.product.currency)}</td>
                          <td>
                            <button type="button" class="btn btn-ghost btn-sm" data-action="remove" data-product-id={c.product.id}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div class="cart-summary">
                <h2>Order summary</h2>
                <div class="summary-lines">
                  <div class="summary-line"><span>Subtotal</span><span>{formatMinor(totals.subtotalMinor, "KES")}</span></div>
                  {totals.deliveryZoneId && deliveryZone && (
                    <div class="summary-line">
                      <span>Delivery — {deliveryZone.name}</span>
                      <span>{formatMinor(totals.deliveryFeeMinor, "KES")}</span>
                    </div>
                  )}
                  {totals.discountMinor > 0 && (
                    <div class="summary-line discount"><span>Discount</span><span>&minus;{formatMinor(totals.discountMinor, "KES")}</span></div>
                  )}
                  <div class="summary-line total"><span>Total payable</span><span>{formatMinor(totals.totalMinor, "KES")}</span></div>
                </div>

                {/* DELIVERY PICKUP TOGGLE */}
                <div class="order-type-toggle">
                  <label class="toggle-opt">
                    <input type="radio" name="orderType" value="pickup" checked />
                    <span class="toggle-label">Pickup</span>
                    <span class="toggle-desc">Collect from MnM Juice Bar, Kabuku</span>
                  </label>
                  <label class="toggle-opt">
                    <input type="radio" name="orderType" value="delivery" />
                    <span class="toggle-label">Delivery</span>
                    <span class="toggle-desc">Delivered to your area — fee shown below</span>
                  </label>
                </div>

                {/* DELIVERY ZONE PICKER (shown when delivery selected) */}
                <div class="delivery-picker" id="delivery-picker">
                  <h3>Delivery zone</h3>
                  <p class="hint">Choose your area to see the delivery fee. If your area isn't listed, choose pickup or call us.</p>
                  <div class="zone-options">
                    {deliveryZones.map((z) => (
                      <label class="zone-option">
                        <input type="radio" name="deliveryZone" value={z.id} data-fee={z.feeMinor} {...(deliveryZone && deliveryZone.id === z.id ? { checked: true } : {})} />
                        <div class="zone-info">
                          <span class="zone-name">{z.name}</span>
                          <span class="zone-desc">{z.description}</span>
                          <span class="zone-fee">{formatMinor(z.feeMinor, "KES")} delivery fee</span>
                          {z.minOrderMinor > 0 && <span class="zone-min">Min order {formatMinor(z.minOrderMinor, "KES")}</span>}
                        </div>
                      </label>
                    ))}
                  </div>
                  <p class="hint">If your area isn't listed, choose a nearby zone and call us to confirm — or choose pickup. Delivery is manually confirmed for unusual locations.</p>
                </div>

                <div class="cart-actions">
                  <a class="btn btn-ghost" href="/menu">&larr; Continue shopping</a>
                  <button class="btn btn-primary btn-lg" id="checkout-btn">
                    Proceed to checkout — {formatMinor(totals.totalMinor, "KES")}
                  </button>
                </div>

                <p class="hint">You'll confirm your name, phone and any notes on the next page. Payment is collected safely after you submit.</p>
              </div>
            </div>
          )}
        </div>

        </Page>,
    );
  });

  // ---------- CHECKOUT ----------
  app.get("/checkout", (c) => {
    const q = new URLSearchParams(c.req.query() as Record<string, string>);
    const itemsJson = q.get("items");
    const deliveryZoneIdRaw = q.get("delivery_zone");
    const deliveryZoneId = deliveryZoneIdRaw ? Number(deliveryZoneIdRaw) : undefined;

    let cartItems: any[] = [];
    let totals = computeJuiceOrderTotals([] as any[], deliveryZoneId);
    let deliveryZones = enabledDeliveryZones();
    let deliveryZone: typeof deliveryZones[0] | null = null;

    if (deliveryZoneId && deliveryZones.length) {
      deliveryZone = deliveryZones.find((z) => z.id === deliveryZoneId) ?? null;
    }

    if (itemsJson) {
      try {
        const parsed = JSON.parse(itemsJson) as any[];
        cartItems = parsed
          .filter((i) => i && typeof i === "object" && i.productId)
          .map((i) => {
            const p = productById(i.productId);
            if (!p) return null;
            return { product: p, item: i };
          })
          .filter(Boolean) as any[];
        totals = computeJuiceOrderTotals(
          cartItems.map((c) => ({
            productId: c.item.productId,
            qty: c.item.qty,
            sizeLabel: c.item.sizeLabel,
            sizePriceMinor: c.item.sizePriceMinor,
            addonsChosen: c.item.addonsChosen,
            addonsPriceMinor: c.item.addonsPriceMinor,
          })),
          deliveryZoneId,
        );
      } catch { cartItems = []; }
    }

    if (cartItems.length === 0) {
      return c.redirect("/menu");
    }

    return c.html(
      <Page title="Checkout — MnM Juice Bar">
        
        <div class="checkout-page">
          <div class="checkout-head">
            <ol class="step-rail" aria-label="Checkout progress">
              <li>Bag</li>
              <li class="is-current">Details</li>
              <li>Confirm</li>
            </ol>
            <h1>Checkout</h1>
            <p class="muted">Almost there — tell us who we're making this for.</p>
          </div>

          <div class="checkout-layout">
            {/* ORDER SUMMARY */}
            <div class="checkout-summary">
              <h2>Order summary</h2>
              <table class="cart-table small">
                <tbody>
                  {cartItems.map((c) => {
                    const item = c.item;
                    const lineTotal = item.qty * ((item.sizePriceMinor ?? 0) + (item.addonsPriceMinor ?? 0) + c.product.priceMinor);
                    return (
                      <tr key={c.product.id}>
                        <td>
                          <div class="cart-item-name">{c.product.name} &times; {item.qty}</div>
                          <p class="muted small">{item.sizeLabel && item.sizeLabel !== "Standard" ? item.sizeLabel : ""}{(item.addonsChosen && item.addonsChosen.length ? ", " : "")}{(item.addonsChosen && item.addonsChosen.length ? item.addonsChosen.join(", ") : "")}</p>
                        </td>
                        <td>{formatMinor(lineTotal, c.product.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div class="summary-lines">
                <div class="summary-line"><span>Subtotal</span><span>{formatMinor(totals.subtotalMinor, "KES")}</span></div>
                <div class="summary-line" data-delivery-line style={totals.deliveryFeeMinor > 0 ? "" : "display:none"}>
                  <span data-delivery-label>Delivery{feeZoneName(deliveryZone)}</span>
                  <span data-delivery-value>{formatMinor(totals.deliveryFeeMinor, "KES")}</span>
                </div>
                <div class="summary-line total" data-total-line data-base-minor={totals.totalMinor - totals.deliveryFeeMinor}>
                  <span>Total payable</span>
                  <span data-total-value>{formatMinor(totals.totalMinor, "KES")}</span>
                </div>
              </div>
            </div>

            {/* FORM */}
            <div class="checkout-form-panel">
              <form method="post" action="/juice/checkout">
                {/* hidden cart snapshot — server recomputes totals from product IDs + snapshot prices */}
                <input type="hidden" name="items" value={itemsJson ?? ""} />

                <div class="form-section">
                  <h3>Contact details</h3>
                  <div class="form-row">
                    <div class="field">
                      <label for="custName">Your name</label>
                      <input id="custName" name="customerName" type="text" required maxlength={120} autocomplete="name" placeholder="e.g. Wanjiku Kamau" />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="field">
                      <label for="custPhone">Phone number <span class="req">*</span></label>
                      <input id="custPhone" name="customerPhone" type="tel" required maxlength={30} autocomplete="tel" placeholder="+2547…" />
                      <p class="hint">We'll call or SMS you about your order.</p>
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="field">
                      <label for="custEmail">Email (optional)</label>
                      <input id="custEmail" name="customerEmail" type="email" maxlength={120} autocomplete="email" placeholder="you@example.com" />
                    </div>
                  </div>
                </div>

                <div class="form-section">
                  <h3>Pickup or delivery</h3>
                  <div class="form-row">
                    <div class="field">
                      <label>Order type</label>
                      <div class="toggle-opt-row">
                        <label class="toggle-opt">
                          <input type="radio" name="type" value="pickup" checked={!deliveryZoneId} />
                          <span>Pickup</span>
                        </label>
                        <label class="toggle-opt">
                          <input type="radio" name="type" value="delivery" checked={!!deliveryZoneId} />
                          <span>Delivery</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div id="delivery-fields" class={deliveryZoneId ? "" : "delivery-fields-hidden"}>
                    <div class="form-row">
                      <div class="field">
                        <label for="deliveryZone">Delivery area</label>
                        <select id="deliveryZone" name="deliveryZoneId" required>
                          <option value="">Select your area…</option>
                          {deliveryZones.map((z) => (
                            <option key={z.id} value={z.id} data-fee={z.feeMinor} data-name={z.name} selected={deliveryZone?.id === z.id}>
                              {z.name} — {formatMinor(z.feeMinor, "KES")} delivery fee
                            </option>
                          ))}
                        </select>
                        <p class="hint">If your area isn't listed, choose a nearby one and call us to confirm.</p>
                      </div>
                    </div>
                    <div class="form-row">
                      <div class="field">
                        <label for="deliveryAddress">Delivery address / location</label>
                        <textarea id="deliveryAddress" name="deliveryAddress" rows={2} maxlength={300} placeholder="Building, landmark, gate code, etc."></textarea>
                      </div>
                    </div>
                    <div class="form-row">
                      <div class="field">
                        <label for="deliveryContact">Best contact for delivery (optional)</label>
                        <input id="deliveryContact" name="deliveryContact" type="tel" maxlength={30} placeholder="+2547…" />
                        <p class="hint">If different from your phone above.</p>
                      </div>
                    </div>
                    <div class="form-row">
                      <div class="field">
                        <label for="deliveryInstructions">Delivery instructions (optional)</label>
                        <textarea id="deliveryInstructions" name="deliveryInstructions" rows={2} maxlength={500} placeholder="Gate is locked after 6pm, call on arrival…"></textarea>
                      </div>
                    </div>
                  </div>

                  <div id="pickup-fields" style={deliveryZoneId ? "display:none" : ""}>
                    <div class="form-row">
                      <div class="field">
                        <label for="pickupName">Pickup name (optional)</label>
                        <input id="pickupName" name="pickupName" type="text" maxlength={120} placeholder="If different from your name" />
                      </div>
                    </div>
                    <div class="form-row">
                      <div class="field">
                        <label for="pickupInstructions">Pickup instructions (optional)</label>
                        <textarea id="pickupInstructions" name="pickupInstructions" rows={2} maxlength={500} placeholder="Call when you arrive…"></textarea>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="form-section">
                  <h3>Your notes (optional)</h3>
                  <div class="form-row">
                    <div class="field">
                      <label for="customerNotes">Anything we should know?</label>
                      <textarea id="customerNotes" name="customerNotes" rows={2} maxlength={500} placeholder="No ice please, allergy notes…"></textarea>
                    </div>
                  </div>
                </div>

                <div class="form-section">
                  <h3>Review and place order</h3>
                  <div class="checkout-total-block">
                    <div class="checkout-total-line"><span>Subtotal</span><span>{formatMinor(totals.subtotalMinor, "KES")}</span></div>
                    <div class="checkout-total-line" data-delivery-line style={totals.deliveryFeeMinor > 0 ? "" : "display:none"}>
                      <span data-delivery-label>Delivery{feeZoneName(deliveryZone)}</span>
                      <span data-delivery-value>{formatMinor(totals.deliveryFeeMinor, "KES")}</span>
                    </div>
                    <div class="checkout-total-line total" data-total-line data-base-minor={totals.totalMinor - totals.deliveryFeeMinor}>
                      <span>Total payable</span>
                      <span data-total-value>{formatMinor(totals.totalMinor, "KES")}</span>
                    </div>
                  </div>
                  <p class="hint">All amounts are calculated on the server from our current prices.</p>
                  <p class="notice warn">
                    <strong>Demonstration checkout — no online payment is taken.</strong>{" "}
                    Your order is saved for staff to prepare; pay on collection or delivery. Live M-Pesa is a separate integration.
                  </p>

                  <div class="form-actions">
                    <a class="btn btn-ghost" href="/cart">&larr; Back to cart</a>
                    <button type="submit" class="btn btn-primary btn-lg" data-place-order>Place order — {formatMinor(totals.totalMinor, "KES")}</button>
                  </div>
                  <p class="hint">By placing this order you reserve the items at the prices shown. No card or M-Pesa prompt is issued in this demonstration.</p>
                </div>
              </form>
            </div>
          </div>
        </div>

        </Page>,
    );
  });

  // ---------- POST CHECKOUT ----------
  // 60 orders / 10 min per client. High enough for a busy shared carrier-NAT
  // address, low enough to stop automated order floods.
  app.post("/juice/checkout", rateLimit({ name: "juice-checkout", limit: 60, windowMs: 10 * 60_000 }), async (c) => {
    // Same exact-origin rule as the ticket checkout and all staff mutations:
    // a juice order creates a customer record, so cross-site form posts are refused.
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) {
      return c.html(
        <Page title="Blocked">
          <div class="panel notice bad">This order could not be accepted from another site. Please reload the shop and try again.</div>
          <p><a class="btn btn-primary" href="/menu">Back to menu</a></p>
        </Page>,
        403,
      );
    }
    const form = await c.req.parseBody() as Record<string, string>;
    const itemsJson = form.items || "";
    const deliveryZoneIdRaw = form.deliveryZoneId || "";
    const typeRaw = form.type || "pickup";
    const customerName = form.customerName || "";
    const customerPhone = form.customerPhone || "";
    const customerEmail = form.customerEmail || "";
    const pickupName = form.pickupName || "";
    const pickupInstructions = form.pickupInstructions || "";
    const deliveryZoneId = deliveryZoneIdRaw ? Number(deliveryZoneIdRaw) : undefined;
    const deliveryAddress = form.deliveryAddress || "";
    const deliveryContact = form.deliveryContact || "";
    const deliveryInstructions = form.deliveryInstructions || "";
    const customerNotes = form.customerNotes || "";

    let items: any[] = [];
    try { items = JSON.parse(itemsJson); } catch { items = []; }

    const type = typeRaw === "delivery" ? "delivery" : "pickup";
    const result = createJuiceOrder({
      items: items.map((i: any) => ({
        productId: Number(i.productId),
        // Pass raw qty through (missing/blank defaults to 1); non-numeric values stay NaN
        // and are rejected server-side by createJuiceOrder instead of silently coerced.
        qty: i.qty === undefined || i.qty === "" ? 1 : Number(i.qty),
        sizeLabel: i.sizeLabel || undefined,
        sizePriceMinor: i.sizePriceMinor ? Number(i.sizePriceMinor) : undefined,
        addonsChosen: i.addonsChosen || undefined,
        addonsPriceMinor: i.addonsPriceMinor ? Number(i.addonsPriceMinor) : undefined,
      })),
      type,
      customerName,
      customerPhone,
      customerEmail: customerEmail || undefined,
      pickupName: pickupName || undefined,
      pickupInstructions: pickupInstructions || undefined,
      deliveryZoneId,
      deliveryAddress: deliveryAddress || undefined,
      deliveryContact: deliveryContact || undefined,
      deliveryInstructions: deliveryInstructions || undefined,
      customerNotes: customerNotes || undefined,
    });

    if (!result.ok) {
      return c.html(
        <Page title="Order could not be placed">
          <div class="panel notice bad">
            <h1>Sorry — {result.msg}</h1>
            <p class="muted">Please check your order and try again, or call {businessSetting("contact_phone")} for help.</p>
            <p><a class="btn btn-primary" href={`/cart?items=${encodeURIComponent(itemsJson)}&delivery_zone=${deliveryZoneIdRaw}`}>Back to cart</a></p>
            <p><a class="btn btn-ghost" href="/menu">Back to menu</a></p>
          </div>
        </Page>,
        400,
      );
    }

    const customer = getCustomerBySession(getCookie(c, CUSTOMER_COOKIE));
    if (customer) linkJuiceOrderToCustomer(result.orderId!, customer.id);

    // Redirect to the token-protected order confirmation page.
    return c.redirect(`/juice/order/${encodeURIComponent(result.orderRef!)}?t=${encodeURIComponent(result.accessToken!)}`);
  });

  // A customer who loses the original link can re-open the order with the
  // reference and the phone number used at checkout. A fresh token is issued.
  // Order lookup is an enumeration target (reference + phone). Keep it tight.
  app.post("/juice/order/lookup", rateLimit({ name: "juice-order-lookup", limit: 20, windowMs: 10 * 60_000 }), async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) {
      return c.html(<Page title="Blocked"><div class="panel notice bad">Cross-origin request blocked.</div></Page>, 403);
    }
    const body = await c.req.parseBody();
    const ref = String(body.ref ?? "").trim();
    const phone = normalisePhoneKenya(String(body.phone ?? ""));
    const order = ref ? juiceOrderByRef(ref) : null;
    if (!order || !phone || normalisePhoneKenya(order.customerPhone) !== phone) {
      return c.html(
        <Page title="Order link">
          <div class="panel narrow">
            <h1>Order link</h1>
            <p class="notice bad">We could not match that order reference and phone number. Check both and try again, or call {businessSetting("contact_phone")}.</p>
            <form method="post" action="/juice/order/lookup">
              <div class="field"><label>Order reference</label><input name="ref" value={ref} required /></div>
              <div class="field"><label>Phone used at checkout</label><input name="phone" inputmode="tel" required /></div>
              <button class="btn btn-primary" type="submit">Open order</button>
            </form>
          </div>
        </Page>,
        404,
      );
    }
    const token = issueJuiceOrderToken(order.id);
    return c.redirect(`/juice/order/${encodeURIComponent(order.orderRef)}?t=${encodeURIComponent(token)}`);
  });

  // ---------- ORDER CONFIRMATION ----------
  app.get("/juice/order/:ref", (c) => {
    const ref = c.req.param("ref");
    const token = c.req.query("t") ?? "";
    if (!checkJuiceOrderAccess(ref, token)) {
      return c.html(
        <Page title="Order link required">
          <div class="panel narrow">
            <h1>Open your order</h1>
            <p class="muted">For your privacy, this order page needs the private link from checkout. If you lost it, enter the order reference and the phone number used at checkout.</p>
            <form method="post" action="/juice/order/lookup">
              <div class="field"><label>Order reference</label><input name="ref" value={ref} required /></div>
              <div class="field"><label>Phone used at checkout</label><input name="phone" inputmode="tel" required /></div>
              <button class="btn btn-primary" type="submit">Open order</button>
            </form>
          </div>
        </Page>,
        403,
      );
    }
    const order = juiceOrderByRef(ref);
    if (!order) {
      return c.html(
        <Page title="Order not found">
          <div class="panel">
            <h1>Order not found</h1>
            <p class="muted">We couldn't find an order with that reference. Check the link or call {businessSetting("contact_phone")}.</p>
            <p><a class="btn btn-primary" href="/menu">Back to menu</a></p>
          </div>
        </Page>,
        404,
      );
    }

    // A freshly created order clears the local bag; reopening an old order
    // link later must not wipe a cart the customer has started since.
    const createdMs = Date.parse(order.createdAt);
    const justPlaced = Number.isFinite(createdMs) && Date.now() - createdMs < 5 * 60_000;
    const statusLabel = statusLabelFor(order.status);
    const isNew = order.status === "new";
    const isPaid = order.paymentStatus === "succeeded";
    const stepLabels = order.type === "delivery"
      ? ["Received", "Preparing", "Ready", "On the way", "Delivered"]
      : ["Received", "Preparing", "Ready", "Awaiting collection", "Collected"];
    const stepIndex = ({
      new: 0, accepted: 0, preparing: 1, ready_for_pickup: 2, ready_for_dispatch: 2,
      out_for_delivery: 3, delivered: 4,
    } as Record<string, number>)[order.status] ?? 0;

    return c.html(
      <Page title={`Order ${order.orderRef} — MnM Juice Bar`}>
        
        <div class="order-confirm-page">
          <div class="order-confirm-card">
            <h2>Thank you, {order.customerName.split(" ")[0] || "friend"}!</h2>
            <p class="order-ref-line">Order {order.orderRef}</p>

            <div class="order-journey" aria-label={`Order status: ${statusLabel}`}>
              {stepLabels.map((label, i) => (
                <div class={`journey-step${i < stepIndex ? " is-done" : ""}${i === stepIndex ? " is-current" : ""}`}>
                  <div class="journey-bar" />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <div class="order-status-block">
              <div class="status-pill">
                <span class={`status-dot ${isNew ? "status-new" : isPaid ? "status-paid" : "status-pending"}`}></span>
                <span class="status-label">{statusLabel}</span>
              </div>
              {isNew ? (
                <p class="hint">Your order is received and the team has been notified. We'll call you if anything needs confirming.</p>
              ) : isPaid ? (
                <p class="notice ok">Payment recorded — we're preparing your order.</p>
              ) : (
                <p class="notice warn">No online payment was taken. Pay on collection or delivery.</p>
              )}
            </div>

            <div class="order-contact-block">
              <h3>We'll contact you at</h3>
              <p><strong>Phone:</strong> {order.customerPhone}</p>
              {order.customerEmail && <p><strong>Email:</strong> {order.customerEmail}</p>}
            </div>

            <div class="order-details-block">
              <h3>Order details</h3>
              <div class="order-meta">
                <div><strong>Type:</strong> {order.type === "pickup" ? "Pickup" : "Delivery"}</div>
                {order.type === "delivery" && order.deliveryZone && (
                  <div><strong>Delivery area:</strong> {order.deliveryZone.name}</div>
                )}
                {order.deliveryAddress && <div><strong>Delivery address:</strong> {order.deliveryAddress}</div>}
                {order.deliveryContact && <div><strong>Delivery contact:</strong> {order.deliveryContact}</div>}
                {order.deliveryInstructions && <div><strong>Instructions:</strong> {order.deliveryInstructions}</div>}
                {order.type === "pickup" && order.pickupInstructions && <div><strong>Pickup notes:</strong> {order.pickupInstructions}</div>}
              </div>

              <table class="cart-table small">
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div class="cart-item-name">{item.productName}</div>
                        <p class="muted small">Qty: {item.qty}{item.sizeLabel && item.sizeLabel !== "Standard" ? ` · ${item.sizeLabel}` : ""}{item.addonsChosen && item.addonsChosen.length ? ` · +${item.addonsChosen.join(", ")}` : ""}</p>
                      </td>
                      <td>{formatMinor(item.lineTotalMinor, order.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div class="summary-lines">
                <div class="summary-line"><span>Subtotal</span><span>{formatMinor(order.subtotalMinor, order.currency)}</span></div>
                {order.deliveryFeeMinor > 0 && <div class="summary-line"><span>Delivery fee</span><span>{formatMinor(order.deliveryFeeMinor, order.currency)}</span></div>}
                {order.discountMinor > 0 && <div class="summary-line discount"><span>Discount</span><span>&minus;{formatMinor(order.discountMinor, order.currency)}</span></div>}
                <div class="summary-line total"><span>Total payable</span><span>{formatMinor(order.totalMinor, order.currency)}</span></div>
              </div>
            </div>

            {order.customerNotes && <div class="order-notes"><strong>Your note:</strong> {order.customerNotes}</div>}

            <div class="order-actions">
              <a class="btn btn-primary" href="/menu">Back to menu</a>
              <a class="btn btn-ghost" href="/contact">Need help? Call us</a>
            </div>
          </div>
        </div>

        {justPlaced && (
          <script dangerouslySetInnerHTML={{ __html: `
            try { sessionStorage.removeItem('mnm_cart_items'); } catch (e) {}
            document.querySelectorAll('#cart-count-mini, [data-cart-count]').forEach(function (el) { el.textContent = '0'; });
            var mini = document.getElementById('cart-count-mini');
            if (mini) mini.style.display = 'none';
            if (window.history && window.history.replaceState) window.history.replaceState({}, '', location.pathname);
          ` }} />
        )}

        </Page>,
    );
  });

  // ---------- ABOUT ----------
  app.get("/about", (c) => {
    const categories = allCategories();
    const aboutBlurb = businessSetting("about_html");
    const hours = businessSetting("opening_hours");
    const address = businessSetting("address_line");
    const phone = businessSetting("contact_phone");
    const tagline = businessSetting("tagline");
    return c.html(
      <Page title="About MnM Juice Bar" active="/about">
        <div class="page-head">
          <p class="kicker">Our story</p>
          <h1>Fresh drinks, made to order in Kabuku</h1>
          <p class="lead">{tagline || "Fresh drinks, crafted with care — Kabuku."}</p>
        </div>

        <section class="section">
          <div class="panel about-teaser">
            <h2>Who we are</h2>
            <div class="about-text">
              <div dangerouslySetInnerHTML={{ __html: aboutBlurb || "<p>MnM Juice Bar is a local juice bar in Kabuku, Limuru — serving fresh drinks and snacks with a friendly neighbourhood feel.</p>" }} />
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2>What we serve</h2>
            <a class="link link-ghost" href="/menu">See the full menu &rarr;</a>
          </div>
          <div class="cat-grid">
            {categories.map((cat) => (
              <a class="cat-card" href={`/menu?category=${cat.id}`}>
                <div class="cat-number">{String(cat.id).padStart(2, "0")}</div>
                <div>
                  <h3>{cat.name}</h3>
                  <p class="muted small">{cat.description}</p>
                </div>
                <span class="cat-arrow">&rarr;</span>
              </a>
            ))}
          </div>
        </section>

        <section class="section section-alt">
          <div class="panel">
            <h2>How we work</h2>
            <ol class="steps-inline">
              <li><span>We pick ripe, seasonal fruit</span></li>
              <li><span>Everything is blended to order</span></li>
              <li><span>You collect it warm, or we deliver it</span></li>
            </ol>
            <p class="hint">No premixed syrups — every drink is made when you order it.</p>
          </div>
        </section>

        <section class="section">
          <div class="panel">
            <h2>Visit us</h2>
            <p class="muted">{address}</p>
            <p class="muted">Phone: <a class="phone-link" href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a></p>
            <div class="about-links">
              <a class="btn btn-primary" href="/menu">Order now</a>
              <a class="btn btn-secondary" href="/catering">Catering &amp; events</a>
              <a class="btn btn-ghost" href="/contact">Contact &amp; location</a>
            </div>
            {hours ? <div class="opening-hours" dangerouslySetInnerHTML={{ __html: hours }} /> : null}
          </div>
        </section>
      </Page>,
    );
  });

  // ---------- CONTACT ----------
  app.get("/contact", (c) => {
    const address = businessSetting("address_line");
    const phone = businessSetting("contact_phone");
    const email = businessSetting("contact_email");
    const hours = businessSetting("opening_hours");
    const instagram = businessSetting("instagram_url");
    const facebook = businessSetting("facebook_url");
    const zones = enabledDeliveryZones();
    return c.html(
      <Page title="Contact MnM Juice Bar" active="/contact">
        <div class="page-head">
          <p class="kicker">Get in touch</p>
          <h1>Contact &amp; location</h1>
          <p class="lead">Call ahead for large orders, or send us a catering enquiry online.</p>
        </div>

        <div class="contact-grid">
          <div class="panel">
            <h2>Visit the bar</h2>
            <p>{address}</p>
            <p class="muted small">We are opposite St. Paul's University, a short walk from Jumuia, Limuru.</p>
            <h3>Phone</h3>
            <p><a class="phone-link" href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a></p>
            {email ? <><h3>Email</h3><p><a href={`mailto:${email}`}>{email}</a></p></> : null}
            {hours ? <><h3>Opening hours</h3><div class="opening-hours" dangerouslySetInnerHTML={{ __html: hours }} /></> : null}
            <div class="about-links">
              <a class="btn btn-primary" href={`tel:${phone.replace(/\s+/g, "")}`}>Call us</a>
              <a class="btn btn-ghost" href="/menu">Order online</a>
            </div>
          </div>

          <div class="panel">
            <h2>Delivery areas</h2>
            <p class="muted small">We deliver to these areas. Fees shown are per delivery; if your area is not listed, choose pickup and call us.</p>
            {zones.length === 0 ? (
              <p class="muted">No delivery zones are configured yet — please call to arrange delivery.</p>
            ) : (
              <table class="cart-table small">
                <thead><tr><th>Area</th><th>Delivery fee</th><th>Minimum order</th></tr></thead>
                <tbody>
                  {zones.map((z) => (
                    <tr>
                      <td><strong>{z.name}</strong><br /><span class="muted small">{z.description}</span></td>
                      <td>{formatMinor(z.feeMinor, "KES")}</td>
                      <td>{z.minOrderMinor > 0 ? formatMinor(z.minOrderMinor, "KES") : "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3>Follow us</h3>
            <div class="social-row">
              {instagram ? <a class="social-link" href={instagram} target="_blank" rel="noopener">Instagram</a> : null}
              {facebook ? <a class="social-link" href={facebook} target="_blank" rel="noopener">Facebook</a> : null}
              <a class="social-link" href="/catering">Catering enquiries</a>
            </div>
          </div>
        </div>
      </Page>,
    );
  });

  // ---------- CATERING ----------
  const CATERING_PACKAGES = [
    { name: "Refreshment Station", pricePerGuest: 250, includes: "Fresh-pressed juices, water, cups and serving tips." },
    { name: "Smoothie Bar", pricePerGuest: 400, includes: "Smoothies and juices, on-site blender, setup and serving staff." },
    { name: "Full MnM Catering", pricePerGuest: 650, includes: "Juices, smoothies, milkshakes, snack platters and full service staff." },
  ];

  app.get("/catering", (c) => {
    const sent = c.req.query("sent") || "";
    const phone = businessSetting("contact_phone");
    return c.html(
      <Page title="Catering & events — MnM Juice Bar" active="/catering">
        <div class="page-head">
          <p class="kicker">Catering &amp; events</p>
          <h1>Fresh drinks for your event</h1>
          <p class="lead">Tell us what you are planning and we will come back with a quote. We cater for birthdays, corporate and church events, campus days and more.</p>
        </div>

        {sent ? (
          <div class="panel notice ok">
            <h2>Thank you — your enquiry is with us</h2>
            <p>Your enquiry reference is <strong>{sent}</strong>. We will call you on the number you gave us to confirm the menu, quantities and a quote.</p>
            <p class="hint">If we cannot reach you within one working day, call {phone} and quote the reference.</p>
            <p><a class="btn btn-primary" href="/menu">Back to the menu</a></p>
          </div>
        ) : null}

        <section class="section">
          <div class="section-head">
            <h2>Sample packages</h2>
            <p class="muted small">Sample prices for demonstration only — the owner confirms final pricing per event.</p>
          </div>
          <div class="product-grid">
            {CATERING_PACKAGES.map((p) => (
              <article class="product-card">
                <div class="product-card-body">
                  <div class="product-card-category">Catering</div>
                  <h3>{p.name}</h3>
                  <p class="product-card-desc">{p.includes}</p>
                  <div class="product-card-bottom">
                    <div class="product-card-price">{formatMinor(p.pricePerGuest * 100, "KES")} <span class="muted small">per guest</span></div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section class="section">
          <div class="panel">
            <h2>Request a quote</h2>
            <p class="muted">Fill this in and we will call you back. No commitment, no payment taken on this form.</p>
            <CateringForm values={{}} />
          </div>
        </section>
      </Page>,
    );
  });

  app.post("/catering", async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) {
      return c.html(
        <Page title="Blocked">
          <div class="panel notice bad">This enquiry could not be accepted from another site. Please reload the page and try again.</div>
          <p><a class="btn btn-primary" href="/catering">Back to catering</a></p>
        </Page>,
        403,
      );
    }
    const form = await c.req.parseBody() as Record<string, string>;
    const values = {
      contactName: form.contactName || "",
      contactPhone: form.contactPhone || "",
      contactEmail: form.contactEmail || "",
      eventType: form.eventType || "",
      eventDate: form.eventDate || "",
      guestCount: form.guestCount || "",
      itemsRequested: form.itemsRequested || "",
      notes: form.notes || "",
    };
    const guestCount = Number(values.guestCount);
    const result = createCateringEnquiry({
      contactName: values.contactName,
      contactPhone: values.contactPhone,
      contactEmail: values.contactEmail || undefined,
      eventType: values.eventType,
      eventDate: values.eventDate || undefined,
      guestCount: Number.isFinite(guestCount) ? Math.trunc(guestCount) : Number.NaN,
      itemsRequested: values.itemsRequested || undefined,
      notes: values.notes || undefined,
    });

    if (!result.ok) {
      return c.html(
        <Page title="Catering enquiry — MnM Juice Bar" active="/catering">
          <div class="page-head">
            <p class="kicker">Catering &amp; events</p>
            <h1>Request a quote</h1>
          </div>
          <div class="panel">
            <div class="panel notice bad">
              <h2>We could not save that enquiry</h2>
              <p>{result.msg}</p>
            </div>
            <CateringForm values={values} />
            <p><a class="btn btn-ghost" href="/catering">Start over</a></p>
          </div>
        </Page>,
        400,
      );
    }
    return c.redirect(`/catering?sent=${encodeURIComponent(result.reference!)}`);
  });

  // Health-check friendly
  app.get("/juice-health", (c) => c.json({ ok: true, service: "mnm-juice", productCount: allProducts({ available: true }).length }));

  return app;
}

// ---------- small components ----------

/** Catering enquiry form. Re-rendered with the submitted values on validation failure. */
function CateringForm({ values }: { values: Record<string, string> }) {
  return (
    <form method="post" action="/catering" class="catering-form">
      <div class="form-section">
        <h3>Your details</h3>
        <div class="form-row">
          <div class="field">
            <label for="catName">Your name <span class="req">*</span></label>
            <input id="catName" name="contactName" type="text" required maxlength={120} value={values.contactName || ""} placeholder="e.g. Achieng Odhiambo" />
          </div>
          <div class="field">
            <label for="catPhone">Phone number <span class="req">*</span></label>
            <input id="catPhone" name="contactPhone" type="tel" required maxlength={30} value={values.contactPhone || ""} placeholder="+2547…" />
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="catEmail">Email (optional)</label>
            <input id="catEmail" name="contactEmail" type="email" maxlength={120} value={values.contactEmail || ""} placeholder="you@example.com" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <h3>Your event</h3>
        <div class="form-row">
          <div class="field">
            <label for="catType">Type of event <span class="req">*</span></label>
            <select id="catType" name="eventType" required>
              <option value="">Select event type…</option>
              {CATERING_EVENT_TYPES.map((t) => (
                <option value={t} selected={values.eventType === t}>{t}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="catDate">Event date (optional)</label>
            <input id="catDate" name="eventDate" type="date" value={values.eventDate || ""} />
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="catGuests">Number of guests <span class="req">*</span></label>
            <input id="catGuests" name="guestCount" type="number" min="1" max="5000" required value={values.guestCount || ""} placeholder="e.g. 50" />
            <p class="hint">We use this to suggest the right quantity of drinks.</p>
          </div>
        </div>
      </div>

      <div class="form-section">
        <h3>What you need</h3>
        <div class="form-row">
          <div class="field">
            <label for="catItems">Drinks or snacks you're after (optional)</label>
            <textarea id="catItems" name="itemsRequested" rows={2} maxlength={2000} placeholder="e.g. Mango smoothies, fresh orange juice, mandazi">{values.itemsRequested || ""}</textarea>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="catNotes">Anything else we should know? (optional)</label>
            <textarea id="catNotes" name="notes" rows={2} maxlength={2000} placeholder="Venue, delivery time, allergies, budget…">{values.notes || ""}</textarea>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-lg">Send catering enquiry</button>
        <a class="btn btn-ghost" href="/menu">&larr; Back to the menu</a>
      </div>
      <p class="hint">We use your details only to prepare and quote your event. No payment is taken on this form.</p>
    </form>
  );
}

function ProductCard({ product: p }: { product: any }) {
  const sizes = p.sizes && p.sizes.length ? p.sizes : null;
  return (
    <article class="product-card">
      <div class="product-card-image">
        {p.primaryImage ? (
          <img src={p.primaryImage} alt={p.name} loading="lazy" />
        ) : (
          <div class="product-card-initials">{initialsFor(p.name)}</div>
        )}
        {p.bestseller && <span class="card-tag bestseller">Popular</span>}
        {p.featured && !p.bestseller && <span class="card-tag featured">Featured</span>}
      </div>
      <div class="product-card-body">
        <div class="product-card-category">{p.category?.name ?? "Drink"}</div>
        <h3>
          <a href={`/product/${p.id}`}>{p.name}</a>
        </h3>
        <p class="product-card-desc">{p.description}</p>
        {p.ingredientNote && <p class="product-card-note small">{p.ingredientNote}</p>}
        <div class="product-card-bottom">
          <div class="product-card-price">{formatMinor(p.priceMinor, p.currency)}</div>
          <a class="btn btn-primary btn-sm add-to-cart-btn" data-product-id={p.id} data-size-label={sizes?.[0]?.label || ""} data-size-price={sizes?.[0]?.priceMinor || 0} href={`/cart?items=${encodeURIComponent(JSON.stringify([{ productId: p.id, qty: 1, sizeLabel: sizes?.[0]?.label || undefined, sizePriceMinor: sizes?.[0]?.priceMinor || undefined, addonsChosen: [], addonsPriceMinor: 0 }]))}&delivery_zone=`}>
            Add to order
          </a>
        </div>
      </div>
    </article>
  );
}

/**
 * Flattens an HTML business setting into plain text for inline copy.
 * Some settings (opening_hours, about_html) are stored as sanitised HTML and are
 * rendered with dangerouslySetInnerHTML where a block is wanted; this helper is
 * for places that must stay plain text (so tags can never leak into a sentence).
 */
/** " — Zone" suffix used by the live delivery-fee line. */
function feeZoneName(zone: { name: string } | null | undefined): string {
  return zone ? ` — ${zone.name}` : "";
}

/** Two clean initials for placeholder art (ignores punctuation and sizes). */
function initialsFor(name: string): string {
  const words = String(name).replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join("") || "Mm").toUpperCase();
}

function plainText(html: string): string {
  return String(html ?? "")
    .replace(/<\s*br\s*\/?\s*>/gi, " · ")
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6])\s*>/gi, " · ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s*·\s*(?:·\s*)+/g, " · ")
    .replace(/^[\s·]+|[\s·]+$/g, "")
    .trim();
}

function starsFor(avg: number): string {
  const full = Math.floor(avg);
  const half = avg - full >= 0.5 ? 1 : 0;
  const empty = Math.max(0, 5 - full - half);
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(empty);
}

function statusLabelFor(status: string): string {
  return ({
    new: "New — awaiting confirmation",
    accepted: "Accepted",
    preparing: "Being prepared",
    ready_for_pickup: "Ready for pickup",
    ready_for_dispatch: "Ready to dispatch",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered",
    cancelled: "Cancelled",
    failed: "Failed",
  }[status] ?? status);
}

// ---------- inline mini-script for cart interactivity ----------
