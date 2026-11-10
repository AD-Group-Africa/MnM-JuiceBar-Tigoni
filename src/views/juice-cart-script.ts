/**
 * Client-side cart interactivity for the MnM Juice Bar storefront.
 *
 * Deliberately framework-free and dependency-free: a single inline script so
 * the storefront stays fast on low-end phones and needs no client bundle.
 *
 * State lives in sessionStorage (mnm_cart_items) and is mirrored into the
 * URL as ?items=... so the cart survives a page reload and every cart /
 * checkout page can be rendered server-side from the same query string.
 *
 * Rendered by the shared page shell (src/views/layout.tsx) on every customer
 * page; on pages without cart controls the event handlers simply never bind.
 */
export const cartInteractivityScript = `
(function() {
  'use strict';

  var STORAGE_KEY = 'mnm_cart_items';

  function getCart() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }
  function setCart(items) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateMiniCartCount();
  }
  function addToCart(productId, qty, sizeLabel, sizePriceMinor, addonsChosen, addonsPriceMinor) {
    var items = getCart();
    var existing = items.find(function(i) {
      return i.productId === productId &&
             i.sizeLabel === sizeLabel &&
             JSON.stringify(i.addonsChosen || []) === JSON.stringify(addonsChosen || []);
    });
    if (existing) {
      existing.qty = Math.min(99, (existing.qty || 1) + (qty || 1));
    } else {
      items.push({
        productId: productId,
        qty: qty || 1,
        sizeLabel: sizeLabel || undefined,
        sizePriceMinor: sizePriceMinor || undefined,
        addonsChosen: addonsChosen || [],
        addonsPriceMinor: addonsPriceMinor || undefined,
      });
    }
    setCart(items);
    updateCartUrl();
  }
  function removeFromCart(productId, sizeLabel, addonsChosen) {
    var items = getCart().filter(function(i) {
      return !(i.productId === productId &&
                i.sizeLabel === sizeLabel &&
                JSON.stringify(i.addonsChosen || []) === JSON.stringify(addonsChosen || []));
    });
    setCart(items);
    updateCartUrl();
  }
  function updateQty(productId, sizeLabel, addonsChosen, delta) {
    var items = getCart();
    var found = items.find(function(i) {
      return i.productId === productId &&
             i.sizeLabel === sizeLabel &&
             JSON.stringify(i.addonsChosen || []) === JSON.stringify(addonsChosen || []);
    });
    if (found) {
      found.qty = Math.max(1, Math.min(99, (found.qty || 1) + delta));
      setCart(items);
      updateCartUrl();
    }
  }
  function updateCartUrl() {
    var items = getCart();
    if (items.length === 0) {
      var url = new URL(window.location.href);
      url.searchParams.delete('items');
      url.searchParams.delete('delivery_zone');
      window.history.replaceState({}, '', url.pathname + url.search);
      updateMiniCartCount();
      return;
    }
    var url = new URL(window.location.href);
    var dz = url.searchParams.get('delivery_zone');
    url.searchParams.set('items', JSON.stringify(items));
    if (dz) url.searchParams.set('delivery_zone', dz);
    window.history.replaceState({}, '', url.pathname + url.search);
    updateMiniCartCount();
  }
  function updateMiniCartCount() {
    var items = getCart();
    var count = items.reduce(function(s, i) { return s + (i.qty || 0); }, 0);
    document.querySelectorAll('#cart-count-mini, [data-cart-count]').forEach(function(el) {
      el.textContent = count;
    });
    var mini = document.getElementById('cart-count-mini');
    if (mini) mini.style.display = count > 0 ? '' : 'none';
  }
  function buildCartUrl() {
    var items = getCart();
    var url = new URL('/cart', window.location.origin);
    if (items.length > 0) url.searchParams.set('items', JSON.stringify(items));
    var dz = document.querySelector('input[name=deliveryZone]:checked');
    if (dz) url.searchParams.set('delivery_zone', dz.value);
    return url.toString();
  }
  function buildCheckoutUrl() {
    var items = getCart();
    var url = new URL('/checkout', window.location.origin);
    if (items.length > 0) url.searchParams.set('items', JSON.stringify(items));
    var dz = document.querySelector('input[name=deliveryZone]:checked');
    if (dz) url.searchParams.set('delivery_zone', dz.value);
    return url.toString();
  }

  // Any link to the cart ("Your order", "View your order") goes straight to the
  // populated cart URL so the server never has to render an empty cart first.
  document.querySelectorAll('a[href="/cart"], .cart-link').forEach(function(link) {
    link.addEventListener('click', function(e) {
      if (getCart().length === 0) return; // nothing added yet: let the server answer
      e.preventDefault();
      window.location.href = buildCartUrl();
    });
  });

  // "Proceed to checkout" button on the cart page
  document.querySelectorAll('#checkout-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      if (getCart().length === 0) { window.location.href = '/menu'; return; }
      window.location.href = buildCheckoutUrl();
    });
  });

  // Add-to-cart buttons on product cards and product detail pages
  document.querySelectorAll('.add-to-cart-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var card = btn.closest('.product-card') || btn.closest('.product-detail') || btn.closest('.product-page');
      if (!card) return;
      var productId = btn.getAttribute('data-product-id');
      if (!productId) {
        var m = window.location.pathname.match(/\\/product\\/(\\d+)/);
        if (m) productId = m[1];
      }
      if (!productId) return;

      var selectedSize = card.querySelector('input[name="size"]:checked');
      var sizeLabel = selectedSize ? selectedSize.value : null;
      var sizePriceMinor = selectedSize ? Number(selectedSize.getAttribute('data-price')) || 0 : 0;

      var selectedAddons = [];
      var addonsPriceMinor = 0;
      var addonChecks = card.querySelectorAll('input[name="addon"]:checked');
      addonChecks.forEach(function(c) {
        selectedAddons.push(c.value);
        var v = Number(c.getAttribute('data-price'));
        if (v) addonsPriceMinor += v;
      });

      addToCart(Number(productId), 1, sizeLabel, sizePriceMinor, selectedAddons, addonsPriceMinor);

      var orig = btn.textContent;
      btn.textContent = 'Added!';
      setTimeout(function() { btn.textContent = orig; }, 1200);
    });
  });

  // Product detail qty control
  var qtyDisplay = document.getElementById('qty-display');
  if (qtyDisplay) {
    var currentQty = 1;
    var decr = document.querySelector('[data-action="decr"]');
    var incr = document.querySelector('[data-action="incr"]');
    var addBtn = document.getElementById('add-to-cart-btn');
    function updateAddButtonText() {
      if (addBtn) {
        var sizePrice = document.querySelector('input[name="size"]:checked');
        var sizePriceMinor = sizePrice ? Number(sizePrice.getAttribute('data-price')) || 0 : 0;
        var addonsPrice = 0;
        document.querySelectorAll('input[name="addon"]:checked').forEach(function(c) {
          var v = Number(c.getAttribute('data-price'));
          if (v) addonsPrice += v;
        });
        var productEl = document.querySelector('.product-price');
        var basePriceText = productEl ? productEl.textContent.replace(/[^0-9.]/g, '') : '0';
        var basePrice = parseFloat(basePriceText) || 0;
        var total = Math.round((basePrice * 100 + sizePriceMinor + addonsPrice) * currentQty) || 0;
        addBtn.textContent = 'Add to order — ' + (total / 100).toLocaleString('en-KE') + ' KES';
      }
    }
    if (decr) decr.addEventListener('click', function() {
      currentQty = Math.max(1, currentQty - 1);
      qtyDisplay.textContent = currentQty;
      updateAddButtonText();
    });
    if (incr) incr.addEventListener('click', function() {
      currentQty = Math.min(99, currentQty + 1);
      qtyDisplay.textContent = currentQty;
      updateAddButtonText();
    });
    document.querySelectorAll('#add-to-cart-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        var m = window.location.pathname.match(/\\/product\\/(\\d+)/);
        if (!m) return;
        var productId = Number(m[1]);
        var selectedSize = document.querySelector('input[name="size"]:checked');
        var sizeLabel = selectedSize ? selectedSize.value : null;
        var sizePriceMinor = selectedSize ? Number(selectedSize.getAttribute('data-price')) || 0 : 0;
        var selectedAddons = [];
        var addonsPriceMinor = 0;
        document.querySelectorAll('input[name="addon"]:checked').forEach(function(c) {
          selectedAddons.push(c.value);
          var v = Number(c.getAttribute('data-price'));
          if (v) addonsPriceMinor += v;
        });
        addToCart(productId, currentQty, sizeLabel, sizePriceMinor, selectedAddons, addonsPriceMinor);
        var orig = btn.textContent;
        btn.textContent = 'Added!';
        setTimeout(function() { btn.textContent = orig; }, 1200);
      });
    });
    updateAddButtonText();
  }

  // Cart page quantity + remove
  document.querySelectorAll('.qty-btn-sm').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var productId = Number(btn.getAttribute('data-product-id'));
      var action = btn.getAttribute('data-action');
      var sizeLabel = btn.closest('tr')?.querySelector('td:nth-child(2)')?.textContent?.trim() || 'Standard';
      var addonsEl = btn.closest('tr')?.querySelector('td:nth-child(3)')?.textContent?.trim();
      var addons = addonsEl && addonsEl !== '—' && addonsEl !== '' ? addonsEl.split(', ') : [];
      if (action === 'incr') updateQty(productId, sizeLabel, addons, 1);
      else if (action === 'decr') updateQty(productId, sizeLabel, addons, -1);
      if (window.location.pathname === '/cart') {
        window.location.href = buildCartUrl();
      } else {
        window.location.href = '/cart';
      }
    });
  });
  document.querySelectorAll('[data-action="remove"]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var productId = Number(btn.getAttribute('data-product-id'));
      var sizeLabel = btn.closest('tr')?.querySelector('td:nth-child(2)')?.textContent?.trim() || 'Standard';
      var addonsEl = btn.closest('tr')?.querySelector('td:nth-child(3)')?.textContent?.trim();
      var addons = addonsEl && addonsEl !== '—' && addonsEl !== '' ? addonsEl.split(', ') : [];
      removeFromCart(productId, sizeLabel, addons);
      window.location.href = '/cart';
    });
  });

  // Delivery/pickup toggle on cart and checkout pages.
  // The cart page uses name="orderType"; the checkout form uses name="type".
  document.querySelectorAll('input[name="orderType"], input[name="type"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      var isDelivery = this.value === 'delivery';
      var deliveryFields = document.getElementById('delivery-fields') || document.querySelector('.delivery-picker');
      var pickupFields = document.getElementById('pickup-fields');
      if (deliveryFields) {
        deliveryFields.style.display = isDelivery ? '' : 'none';
        // The SSR'd wrapper hides itself with a class; clear it or '' won't show it.
        deliveryFields.classList.toggle('delivery-fields-hidden', !isDelivery);
      }
      if (pickupFields) pickupFields.style.display = isDelivery ? 'none' : '';
      // A control inside a hidden container still blocks submit in Chrome
      // ("not focusable"), so the delivery zone is only required for delivery.
      var zoneSelectRequired = document.querySelector('select[name="deliveryZoneId"]');
      if (zoneSelectRequired) zoneSelectRequired.required = isDelivery;
      // On the checkout page the zone is a <select name=deliveryZoneId>; on the
      // cart page it is a radio named deliveryZone. Mirror the URL param so a
      // reload keeps the chosen zone.
      var dz = document.querySelector('input[name="deliveryZone"]:checked');
      var dzSelect = document.querySelector('select[name="deliveryZoneId"]');
      var url = new URL(window.location.href);
      if (isDelivery) {
        var zoneVal = dz ? dz.value : (dzSelect && dzSelect.value ? dzSelect.value : null);
        if (zoneVal) url.searchParams.set('delivery_zone', zoneVal);
        else url.searchParams.delete('delivery_zone');
      } else {
        url.searchParams.delete('delivery_zone');
      }
      var items = getCart();
      if (items.length > 0) url.searchParams.set('items', JSON.stringify(items));
      window.history.replaceState({}, '', url.pathname + url.search);
      updateMiniCartCount();
    });
  });

  // Initial order-type sync: the checkout page opens on Pickup, so the hidden
  // delivery-zone select must not be required until Delivery is chosen.
  (function() {
    var zoneSelect = document.querySelector('select[name="deliveryZoneId"]');
    var checkedType = document.querySelector('input[name="type"]:checked');
    if (zoneSelect && checkedType) zoneSelect.required = checkedType.value === 'delivery';
  })();

  // Delivery zone selection updates URL and reloads cart to show updated fee
  document.querySelectorAll('input[name="deliveryZone"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      var url = new URL(window.location.href);
      if (this.value) url.searchParams.set('delivery_zone', this.value);
      else url.searchParams.delete('delivery_zone');
      var items = getCart();
      if (items.length > 0) url.searchParams.set('items', JSON.stringify(items));
      window.history.replaceState({}, '', url.pathname + url.search);
      if (window.location.pathname === '/cart') window.location.reload();
    });
  });

  // ---- Cart / checkout hydration -----------------------------------------
  // /cart and /checkout are rendered from ?items=... by the server. Two cases
  // need reconciling client-side:
  //   - a deep link (or a fresh tab) carries items in the URL but has no storage
  //   - a bare link (mini cart, bookmark) arrives with no URL items but has storage
  if (window.location.pathname === '/cart' || window.location.pathname === '/checkout') {
    var here = new URL(window.location.href);
    var urlItems = here.searchParams.get('items');
    var storedItems = getCart();
    if (urlItems && storedItems.length === 0) {
      try {
        var parsedItems = JSON.parse(urlItems);
        if (Array.isArray(parsedItems) && parsedItems.length > 0) {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsedItems));
        }
      } catch (e) { /* ignore malformed links */ }
    } else if (!urlItems && storedItems.length > 0) {
      here.searchParams.set('items', JSON.stringify(storedItems));
      window.location.replace(here.toString());
      return;
    }
  }

  // Initial mini cart count
  updateMiniCartCount();
})();
`;
