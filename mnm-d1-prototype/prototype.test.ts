// Prototype test for D1 compatibility - critical behavior verification
import { d1Db } from "./d1-mock";

// Test 1: Basic CRUD operations
console.log("=== Test 1: Basic CRUD operations ===");

// Insert a ticket category
const catResult = d1Db.runSql(
  "INSERT INTO ticket_categories (name, price_minor, quota) VALUES (?, ?, ?)",
  ["General Admission", 500, 100]
);
console.log(`Insert category: changes=${catResult.changes}, lastId=${catResult.lastInsertRowid}`);

// Query all categories
const categories = d1Db.queryAll("SELECT * FROM ticket_categories");
console.log(`Query categories: ${categories.length} rows`);

// Insert an order
const orderResult = d1Db.runSql(
  "INSERT INTO orders (customer_name, customer_phone, total_minor, currency, lifecycle, order_ref) VALUES (?, ?, ?, ?, ?, ?)",
  ["Test User", "+254700123456", 500, "KES", "pending", "ORD-001"]
);
console.log(`Insert order: changes=${orderResult.changes}, lastId=${orderResult.lastInsertRowid}`);

// Insert a ticket
const ticketResult = d1Db.runSql(
  "INSERT INTO tickets (event_id, order_id, ticket_code, status) VALUES (?, ?, ?, ?)",
  [1, orderResult.lastInsertRowid, "TICKET-001", "valid"]
);
console.log(`Insert ticket: changes=${ticketResult.changes}, lastId=${ticketResult.lastInsertRowid}`);

// Test 2: Foreign key enforcement
console.log("\n=== Test 2: Foreign key enforcement ===");

// Try inserting ticket with invalid order_id
const fkResult = d1Db.runSql(
  "INSERT INTO tickets (event_id, order_id, ticket_code, status) VALUES (?, ?, ?, ?)",
  [999, 999, "TICKET-BAD", "valid"]
);
console.log(`Insert ticket with bad FK: changes=${fkResult.changes}`);

// Test 3: Transaction with BEGIN IMMEDIATE (D1 compatible)
console.log("\n=== Test 3: Transaction with BEGIN IMMEDIATE ===");
const txResult = d1Db.runSql(`BEGIN IMMEDIATE`);
console.log(`BEGIN IMMEDIATE: OK`);

// Insert another category within transaction
const txInsert = d1Db.runSql(
  "INSERT INTO ticket_categories (name, price_minor, quota) VALUES (?, ?, ?)",
  ["VIP", 1500, 20]
);
console.log(`TX insert: changes=${txInsert.changes}`);

const txCommit = d1Db.runSql(`COMMIT`);
console.log(`COMMIT: OK`);

// Test 4: Concurrent reservation scenario (two attempts for same ticket)
console.log("\n=== Test 4: Concurrent reservation ===");

// Setup: create a category with quota=1
d1Db.runSql("DELETE FROM ticket_categories WHERE name='Concurrent Test'");
d1Db.runSql("INSERT INTO ticket_categories (name, price_minor, quota) VALUES (?, ?, ?)", ["Concurrent Test", 100, 1]);

// First purchase
const firstPurchase = d1Db.runSql(
  "UPDATE ticket_categories SET sold = sold + 1, active = sold < quota WHERE id = (SELECT id FROM ticket_categories WHERE name='Concurrent Test') AND sold < quota"
);
console.log(`First purchase (sold=0->1): changes=${firstPurchase.changes}`);

// Second purchase should fail since quota=1
const secondPurchase = d1Db.runSql(
  "UPDATE ticket_categories SET sold = sold + 1, active = sold < quota WHERE id = (SELECT id FROM ticket_categories WHERE name='Concurrent Test') AND sold < quota"
);
console.log(`Second purchase (sold=1->2, should fail): changes=${secondPurchase.changes}`);

// Verify sold is still 1
const verify = d1Db.queryOne("SELECT sold FROM ticket_categories WHERE name='Concurrent Test'");
console.log(`Verification: sold=${verify?.sold} (expected: 1)`);

// Test 5: Ticket redemption (atomic UPDATE with status check)
console.log("\n=== Test 5: Atomic ticket redemption ===");
d1Db.runSql("DELETE FROM tickets WHERE ticket_code='REDEEM-TEST'");
const redeemInit = d1Db.runSql(
  "INSERT INTO tickets (event_id, order_id, ticket_code, status) VALUES (?, ?, ?, ?)",
  [1, 1, "REDEEM-TEST", "valid"]
);
console.log(`Init ticket: changes=${redeemInit.changes}`);

// First redemption should succeed
const firstRedeem = d1Db.runSql(
  "UPDATE tickets SET status='redeemed', redeemed_at=datetime('now'), redeemed_by=1 WHERE ticket_code='REDEEM-TEST' AND status='valid'"
);
console.log(`First redemption: changes=${firstRedeem.changes}`);

// Second redemption should fail (status no longer 'valid')
const secondRedeem = d1Db.runSql(
  "UPDATE tickets SET status='redeemed', redeemed_at=datetime('now'), redeemed_by=1 WHERE ticket_code='REDEEM-TEST' AND status='valid'"
);
console.log(`Second redemption (should fail): changes=${secondRedeem.changes}`);

console.log("\n=== All prototype tests completed ===");
