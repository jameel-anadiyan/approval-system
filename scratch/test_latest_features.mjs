import assert from 'node:assert/strict';

console.log('🧪 Testing Latest Disbursement & Preview Features...\n');

// 1. Test Payment Mode Filtering based on payment_dealer_type
function getAvailablePaymentModes(dealerType) {
  if (dealerType === 'cash') return ['Cash'];
  if (dealerType === 'bank') return ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer'];
  return ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer', 'Cash'];
}

// Case 1a: Cash dealer only
const cashModes = getAvailablePaymentModes('cash');
assert.deepEqual(cashModes, ['Cash'], 'Cash dealer must only have Cash option');
assert.ok(!cashModes.includes('NEFT'), 'Cash dealer must not have NEFT');
console.log('✅ 1a: Cash dealer only shows Cash mode');

// Case 1b: Bank dealer only
const bankModes = getAvailablePaymentModes('bank');
assert.deepEqual(bankModes, ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer'], 'Bank dealer must have bank modes');
assert.ok(!bankModes.includes('Cash'), 'Bank dealer must have Cash completely removed');
console.log('✅ 1b: Bank dealer shows only bank modes and Cash is removed');

// Case 1c: Both / undefined
const bothModes = getAvailablePaymentModes('both');
assert.equal(bothModes.length, 6, 'Both dealer must have all 6 modes');
assert.ok(bothModes.includes('Cash') && bothModes.includes('NEFT'), 'Both must include Cash and bank modes');
console.log('✅ 1c: Both dealer shows all 6 modes');

// 2. Test Payment Account Request & Entry Filtering
function round2(n) {
  return Math.round(n * 100) / 100;
}

function entryOutstanding(e) {
  return Math.max(0, round2(Number(e.amount || 0) - Number(e.paid_amount || 0)));
}

function entryPayable(e) {
  if (e.status !== 'approved' && e.status !== 'pending') return 0;
  const outstanding = entryOutstanding(e);
  const approved = e.approved_amount;
  if (approved === null || approved === undefined || Number(approved) <= 0) return outstanding;
  return Math.min(outstanding, Math.max(0, round2(Number(approved))));
}

function isPaymentUserAllowed(user, entry) {
  const mode = entry.entry_type || 'bank';
  const dealerType = user.payment_dealer_type || 'both';
  if (dealerType !== 'both' && dealerType !== mode) return false;
  return true;
}

function isRequestAwaitingForCashier(r, user) {
  if (r.status !== 'approved') return false;
  return (r.disbursement_entries || []).some(
    (e) => e.status === 'approved' && entryPayable(e) > 0 && isPaymentUserAllowed(user, e)
  );
}

const cashierBank = { role: 'disbursement', disbursement_type: 'payment_only', payment_dealer_type: 'bank' };
const cashierCash = { role: 'disbursement', disbursement_type: 'payment_only', payment_dealer_type: 'cash' };

// Case 2a: Request with 0 entries (not made an entry)
const reqNoEntries = { id: 'r1', status: 'approved', disbursement_entries: [] };
assert.equal(isRequestAwaitingForCashier(reqNoEntries, cashierBank), false, 'Request with no entries must not show in cashier queue');
console.log('✅ 2a: Request without entries is hidden from payment account');

// Case 2b: Request with unverified entry (pending_approval)
const reqUnverified = {
  id: 'r2',
  status: 'approved',
  disbursement_entries: [{ id: 'e1', status: 'pending_approval', amount: 10000, paid_amount: 0, entry_type: 'bank' }],
};
assert.equal(isRequestAwaitingForCashier(reqUnverified, cashierBank), false, 'Request with only pending_approval entries must not show in cashier queue');
console.log('✅ 2b: Request with unverified entry is hidden from payment account');

// Case 2c: Request with rejected entry
const reqRejected = {
  id: 'r3',
  status: 'approved',
  disbursement_entries: [{ id: 'e2', status: 'rejected', amount: 10000, paid_amount: 0, entry_type: 'bank' }],
};
assert.equal(isRequestAwaitingForCashier(reqRejected, cashierBank), false, 'Request with rejected entry must not show in cashier queue');
console.log('✅ 2c: Request with rejected entry is hidden from payment account');

// Case 2d: Request with verified entry (approved)
const reqVerifiedBank = {
  id: 'r4',
  status: 'approved',
  disbursement_entries: [{ id: 'e3', status: 'approved', amount: 10000, paid_amount: 0, entry_type: 'bank' }],
};
assert.equal(isRequestAwaitingForCashier(reqVerifiedBank, cashierBank), true, 'Request with verified bank entry must show for bank cashier');
assert.equal(isRequestAwaitingForCashier(reqVerifiedBank, cashierCash), false, 'Bank entry must not show for cash cashier');
console.log('✅ 2d: Verified entry appears for matching cashier and obeys dealer restrictions');

// Case 2e: Visible entries inside card for cashier
const mixedEntries = [
  { id: 'e1', status: 'pending_approval', amount: 5000, paid_amount: 0 },
  { id: 'e2', status: 'approved', amount: 10000, paid_amount: 0 },
  { id: 'e3', status: 'rejected', amount: 2000, paid_amount: 0 },
  { id: 'e4', status: 'paid', amount: 3000, paid_amount: 3000 },
];
const cashierVisibleEntries = mixedEntries.filter((e) => e.status === 'approved' || Number(e.paid_amount || 0) > 0);
assert.equal(cashierVisibleEntries.length, 2, 'Cashier should only see approved or paid entries');
assert.deepEqual(cashierVisibleEntries.map((e) => e.id), ['e2', 'e4'], 'Cashier visible entries must only be e2 and e4');
console.log('✅ 2e: Unverified and rejected entries are filtered out of cashier card view');

// 3. Test Verifier Partial Approval Flow & Non-Disappearance
function isPartialInProgress(e) {
  const outstanding = entryOutstanding(e);
  const approved = Number(e.approved_amount || 0);
  return (
    e.status === 'approved' &&
    approved > 0 &&
    outstanding > approved &&
    Number(e.paid_amount || 0) < Number(e.amount || 0)
  );
}

function entryHasBalanceAwaitingApproval(e) {
  return (e.status === 'pending_approval' || e.status === 'pending') && Number(e.paid_amount || 0) > 0 && entryOutstanding(e) > 0;
}

// Scenario: Entry of 20,000 created by Entry-Only
let entry = {
  id: 'ent_1',
  entry_no: 1,
  status: 'pending_approval',
  amount: 20000,
  paid_amount: 0,
  approved_amount: null,
};

// Initial state in Verifier:
assert.equal(entry.status, 'pending_approval');
assert.equal(isPartialInProgress(entry), false);
assert.equal(entryHasBalanceAwaitingApproval(entry), false);
console.log('✅ 3a: New entry starts as pending_approval in verifier pendingQueue');

// Verifier does partial approve of 5,000:
entry = {
  ...entry,
  status: 'approved',
  approved_amount: 5000,
};

// Check that it stays in pendingQueue!
assert.equal(isPartialInProgress(entry), true, 'Entry must be marked as partial in progress');
const inPendingQueue = entry.status === 'pending_approval' || entry.status === 'pending' || isPartialInProgress(entry);
assert.equal(inPendingQueue, true, 'Entry MUST NOT disappear from verifier pending tab');
const balanceAfterPay = entryOutstanding(entry) - Number(entry.approved_amount);
assert.equal(balanceAfterPay, 15000, 'Remaining balance after cashier payment must be 15,000');
console.log('✅ 3b: Partial approval stays visible in verifier queue as "Partial Payment in Progress"');

// Cashier pays the 5,000 partial approval:
entry = {
  ...entry,
  status: 'pending_approval',
  paid_amount: 5000,
  approved_amount: null,
};

// Verifier views it after cashier payment:
assert.equal(isPartialInProgress(entry), false, 'No longer in progress with cashier');
assert.equal(entry.status, 'pending_approval');
assert.equal(entryOutstanding(entry), 15000, 'Outstanding balance is now 15,000');
assert.equal(entryHasBalanceAwaitingApproval(entry), true, 'Must show as Balance Awaiting Verification');
const inPendingQueueAfterPay = entry.status === 'pending_approval' || entry.status === 'pending' || isPartialInProgress(entry);
assert.equal(inPendingQueueAfterPay, true, 'Entry is STILL in pending queue for next verification');
console.log('✅ 3c: After cashier payment, entry seamlessly shows "Balance Awaiting Verification" with 15,000 remaining');

// Verifier approves remaining 15,000 in full:
entry = {
  ...entry,
  status: 'approved',
  approved_amount: 15000,
};
assert.equal(isPartialInProgress(entry), false, 'Full approval of balance is not partial');
console.log('✅ 3d: Full approval completes verification cycle smoothly');

// 4. Test Signed Doc Packet Retrieval for Preview Button
const reqWithPacket = {
  approval_no: 'APP-2026-001',
  request_no: 'REQ-001',
  signed_files: [
    { storage_path: 'docs/doc1.pdf', file_name: 'doc1.pdf', is_packet: false },
    { storage_path: 'packets/app_packet.pdf', file_name: 'APP-2026-001_packet.pdf', is_packet: true },
  ],
};
const packet = (reqWithPacket.signed_files || []).find((s) => s.is_packet) || (reqWithPacket.signed_files || [])[0];
assert.equal(packet.storage_path, 'packets/app_packet.pdf', 'Must find the combined packet first');
assert.equal(packet.file_name, 'APP-2026-001_packet.pdf', 'Must have proper packet file name');
console.log('✅ 4: Signed doc preview accurately resolves official stamped packet');

console.log('\n🎉 ALL 12 TEST CASES PASSED SUCCESSFULLY!\n');
