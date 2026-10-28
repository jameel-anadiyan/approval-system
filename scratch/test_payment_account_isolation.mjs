import assert from 'node:assert/strict';

console.log('🧪 Testing Payment Account Isolation: Awaiting, Settled, and Paid Queues & Entries...\n');

// 1. Recreate the functions as defined in src/lib/disbursementRouting.ts
function getFullPaymentUser(currentUser, allUsers = []) {
  if (!currentUser) return currentUser;
  const match = allUsers.find((u) => u.id === currentUser.id);
  if (!match) return currentUser;
  return {
    ...match,
    ...currentUser,
    payment_dealer_type: currentUser.payment_dealer_type || match.payment_dealer_type || 'both',
    connected_entry_accounts:
      (currentUser.connected_entry_accounts && currentUser.connected_entry_accounts.length > 0)
        ? currentUser.connected_entry_accounts
        : (match.connected_entry_accounts || []),
  };
}

function entryPayable(entry) {
  if (!entry) return 0;
  if (entry.status === 'paid' || entry.status === 'cancelled') return 0;
  if (entry.status !== 'approved' && entry.status !== 'pending') return 0;
  const target = Number(entry.amount) || 0;
  const paid = Number(entry.paid_amount) || 0;
  const outstanding = Math.max(0, Math.round((target - paid) * 100) / 100);
  if (entry.approved_amount !== undefined && entry.approved_amount !== null) {
    const verifiedRemaining = Math.max(0, Math.round(Number(entry.approved_amount) * 100) / 100);
    return Math.min(outstanding, verifiedRemaining);
  }
  return outstanding;
}

function isPaymentUserAllowedForEntry(currentUser, entry, request, allUsers = []) {
  if (!currentUser) return { allowed: false, reason: 'Must be logged in' };
  if (currentUser.role === 'admin') return { allowed: true };
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') {
    return { allowed: false, reason: 'Only Payment Only disbursement accounts can disburse payments' };
  }

  const user = getFullPaymentUser(currentUser, allUsers) || currentUser;

  // 1. Dealer mode check (cash vs bank)
  const mode = entry.entry_type || 'bank';
  const dealerType = user.payment_dealer_type || 'both';
  if (dealerType !== 'both' && dealerType !== mode) {
    return {
      allowed: false,
      isRestrictedDealer: true,
      reason: `Dealer mismatch: Your account handles ${dealerType.toUpperCase()} disbursements, but this entry is designated as ${mode.toUpperCase()}.`,
    };
  }

  const entryUserId = entry.created_by || request.assigned_entry_user_id;

  // 2. Check if current user is restricted to specific entry accounts
  const myConnectedIds = (user.connected_entry_accounts || []).map((c) =>
    typeof c === 'string' ? c : c.entry_user_id
  );
  if (myConnectedIds.length > 0) {
    if (!entryUserId || !myConnectedIds.includes(entryUserId)) {
      return {
        allowed: false,
        isRestrictedAccount: true,
        reason: 'Restricted: This entry is from an Entry Account not assigned to your payment account.',
      };
    }
  }

  // 3. Check if this entry account is specifically linked to certain payment cashiers
  if (entryUserId && allUsers.length > 0) {
    const paymentUsersLinkedToThisEntry = allUsers.filter(
      (u) =>
        u.role === 'disbursement' &&
        u.disbursement_type === 'payment_only' &&
        (u.connected_entry_accounts || []).some((c) =>
          typeof c === 'string' ? c === entryUserId : c.entry_user_id === entryUserId
        )
    );
    if (paymentUsersLinkedToThisEntry.length > 0) {
      const isMeLinked = paymentUsersLinkedToThisEntry.some((u) => u.id === user.id);
      if (!isMeLinked) {
        const linkedNames = paymentUsersLinkedToThisEntry.map((u) => u.full_name).join(', ');
        return {
          allowed: false,
          isRestrictedAccount: true,
          reason: `Routing restriction: Only the linked payment cashier (${linkedNames}) can disburse this entry.`,
        };
      }
    }
  }

  return { allowed: true };
}

function isEntryAssociatedWithPaymentUser(currentUser, entry, request, allUsers = []) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') return false;

  // Was it paid by me?
  if (entry.paid_by === currentUser.id) return true;
  if ((request.payments || []).some((p) => p.entry_id === entry.id && p.paid_by === currentUser.id)) return true;

  // If it was already fully settled/paid by someone else, it is not associated with this cashier
  if (
    entry.paid_by &&
    entry.paid_by !== currentUser.id &&
    entry.status === 'paid' &&
    Number(entry.paid_amount || 0) > 0
  ) {
    return false;
  }

  // Is it routable to me?
  return isPaymentUserAllowedForEntry(currentUser, entry, request, allUsers).allowed;
}

function canPaymentUserViewAwaitingRequest(currentUser, request, allUsers = []) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return request.status === 'approved';
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') return false;

  if (request.status !== 'approved') return false;

  return (request.disbursement_entries || []).some(
    (e) =>
      e.status === 'approved' &&
      entryPayable(e) > 0 &&
      isPaymentUserAllowedForEntry(currentUser, e, request, allUsers).allowed
  );
}

function canPaymentUserViewPaidRequest(currentUser, request, allUsers = []) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return request.status === 'paid';
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') return false;

  // 1. Did I make any payment on this request?
  const hasMyPayment = (request.payments || []).some((p) => p.paid_by === currentUser.id);
  if (hasMyPayment) return true;

  // 2. Was any entry paid by me?
  const hasMyPaidEntry = (request.disbursement_entries || []).some(
    (e) => e.paid_by === currentUser.id && Number(e.paid_amount || 0) > 0
  );
  if (hasMyPaidEntry) return true;

  // 3. Or does it have an entry associated with me that is settled/paid?
  const hasMyAssociatedSettledEntry = (request.disbursement_entries || []).some(
    (e) =>
      (Number(e.paid_amount || 0) > 0 || e.status === 'paid') &&
      (!e.paid_by || e.paid_by === currentUser.id) &&
      isPaymentUserAllowedForEntry(currentUser, e, request, allUsers).allowed
  );
  return hasMyAssociatedSettledEntry;
}

// --------------------------------------------------------------------------
// TEST FIXTURES
// --------------------------------------------------------------------------
const entryUser1 = { id: 'entry-user-1', full_name: 'Entry Clerk North', role: 'disbursement', disbursement_type: 'entry_only' };
const entryUser2 = { id: 'entry-user-2', full_name: 'Entry Clerk South', role: 'disbursement', disbursement_type: 'entry_only' };

const cashCashier = {
  id: 'cash-cashier-id',
  full_name: 'Cash Cashier',
  role: 'disbursement',
  disbursement_type: 'payment_only',
  payment_dealer_type: 'cash',
  connected_entry_accounts: [],
};

const bankCashier = {
  id: 'bank-cashier-id',
  full_name: 'Bank Cashier',
  role: 'disbursement',
  disbursement_type: 'payment_only',
  payment_dealer_type: 'bank',
  connected_entry_accounts: [],
};

const southCashier = {
  id: 'south-cashier-id',
  full_name: 'South Exclusive Cashier',
  role: 'disbursement',
  disbursement_type: 'payment_only',
  payment_dealer_type: 'both',
  connected_entry_accounts: ['entry-user-2'],
};

const otherCashier = {
  id: 'other-cashier-id',
  full_name: 'Other Cashier',
  role: 'disbursement',
  disbursement_type: 'payment_only',
  payment_dealer_type: 'both',
  connected_entry_accounts: [],
};

const allUsers = [entryUser1, entryUser2, cashCashier, bankCashier, southCashier, otherCashier];

// Request 1: Cash request with approved entry created by entryUser1
const reqCashAwaiting = {
  id: 'req-1',
  status: 'approved',
  assigned_entry_user_id: 'entry-user-1',
  disbursement_entries: [
    {
      id: 'e-1',
      entry_no: 1,
      entry_type: 'cash',
      amount: 5000,
      status: 'approved',
      created_by: 'entry-user-1',
    },
  ],
  payments: [],
};

// Request 2: Bank request with approved entry created by entryUser1
const reqBankAwaiting = {
  id: 'req-2',
  status: 'approved',
  assigned_entry_user_id: 'entry-user-1',
  disbursement_entries: [
    {
      id: 'e-2',
      entry_no: 1,
      entry_type: 'bank',
      amount: 15000,
      status: 'approved',
      created_by: 'entry-user-1',
    },
  ],
  payments: [],
};

// Request 3: Mixed request with Entry 1 (Cash, approved) and Entry 2 (Bank, approved)
const reqMixedAwaiting = {
  id: 'req-3',
  status: 'approved',
  assigned_entry_user_id: 'entry-user-1',
  disbursement_entries: [
    {
      id: 'e-3a',
      entry_no: 1,
      entry_type: 'cash',
      amount: 2000,
      status: 'approved',
      created_by: 'entry-user-1',
    },
    {
      id: 'e-3b',
      entry_no: 2,
      entry_type: 'bank',
      amount: 8000,
      status: 'approved',
      created_by: 'entry-user-1',
    },
  ],
  payments: [],
};

// Request 4: Request with unapproved entry (still pending entry approval)
const reqUnapprovedEntry = {
  id: 'req-4',
  status: 'approved',
  assigned_entry_user_id: 'entry-user-1',
  disbursement_entries: [
    {
      id: 'e-4',
      entry_no: 1,
      entry_type: 'cash',
      amount: 5000,
      status: 'pending_approval',
      created_by: 'entry-user-1',
    },
  ],
  payments: [],
};

// Request 5: Paid request, paid by cashCashier
const reqPaidByCashCashier = {
  id: 'req-5',
  status: 'paid',
  assigned_entry_user_id: 'entry-user-1',
  disbursement_entries: [
    {
      id: 'e-5',
      entry_no: 1,
      entry_type: 'cash',
      amount: 5000,
      paid_amount: 5000,
      status: 'paid',
      paid_by: 'cash-cashier-id',
      created_by: 'entry-user-1',
    },
  ],
  payments: [
    {
      id: 'pay-5',
      entry_id: 'e-5',
      amount: 5000,
      paid_by: 'cash-cashier-id',
      payment_mode: 'Cash',
    },
  ],
};

// Request 6: Paid request, paid by otherCashier (bank payment)
const reqPaidByOtherCashier = {
  id: 'req-6',
  status: 'paid',
  assigned_entry_user_id: 'entry-user-1',
  disbursement_entries: [
    {
      id: 'e-6',
      entry_no: 1,
      entry_type: 'bank',
      amount: 50000,
      paid_amount: 50000,
      status: 'paid',
      paid_by: 'other-cashier-id',
      created_by: 'entry-user-1',
    },
  ],
  payments: [
    {
      id: 'pay-6',
      entry_id: 'e-6',
      amount: 50000,
      paid_by: 'other-cashier-id',
      payment_mode: 'NEFT',
    },
  ],
};

// --------------------------------------------------------------------------
// TEST 1: Cash Cashier Awaiting Queue
// --------------------------------------------------------------------------
console.log('Testing Test 1: Cash Cashier Awaiting Queue...');
assert.equal(canPaymentUserViewAwaitingRequest(cashCashier, reqCashAwaiting, allUsers), true, 'Cash cashier must see Cash awaiting request');
assert.equal(canPaymentUserViewAwaitingRequest(cashCashier, reqBankAwaiting, allUsers), false, 'Cash cashier must NOT see Bank awaiting request');
assert.equal(canPaymentUserViewAwaitingRequest(cashCashier, reqMixedAwaiting, allUsers), true, 'Cash cashier must see Mixed request because it has a Cash entry');
assert.equal(canPaymentUserViewAwaitingRequest(cashCashier, reqUnapprovedEntry, allUsers), false, 'Unapproved entry must NOT show in Awaiting');
console.log('✅ Test 1 Passed: Cash cashier awaiting queue is strictly filtered to cash entries!');

// --------------------------------------------------------------------------
// TEST 2: Bank Cashier Awaiting Queue
// --------------------------------------------------------------------------
console.log('\nTesting Test 2: Bank Cashier Awaiting Queue...');
assert.equal(canPaymentUserViewAwaitingRequest(bankCashier, reqCashAwaiting, allUsers), false, 'Bank cashier must NOT see Cash awaiting request');
assert.equal(canPaymentUserViewAwaitingRequest(bankCashier, reqBankAwaiting, allUsers), true, 'Bank cashier must see Bank awaiting request');
assert.equal(canPaymentUserViewAwaitingRequest(bankCashier, reqMixedAwaiting, allUsers), true, 'Bank cashier must see Mixed request because it has a Bank entry');
console.log('✅ Test 2 Passed: Bank cashier awaiting queue is strictly filtered to bank entries!');

// --------------------------------------------------------------------------
// TEST 3: Card Entries Isolation inside Mixed Request
// --------------------------------------------------------------------------
console.log('\nTesting Test 3: Card Entries Isolation inside Mixed Request...');
const cashCashierEntriesInMixed = reqMixedAwaiting.disbursement_entries.filter((e) =>
  isEntryAssociatedWithPaymentUser(cashCashier, e, reqMixedAwaiting, allUsers)
);
assert.equal(cashCashierEntriesInMixed.length, 1);
assert.equal(cashCashierEntriesInMixed[0].id, 'e-3a', 'Cash cashier must ONLY see the Cash entry in the card');

const bankCashierEntriesInMixed = reqMixedAwaiting.disbursement_entries.filter((e) =>
  isEntryAssociatedWithPaymentUser(bankCashier, e, reqMixedAwaiting, allUsers)
);
assert.equal(bankCashierEntriesInMixed.length, 1);
assert.equal(bankCashierEntriesInMixed[0].id, 'e-3b', 'Bank cashier must ONLY see the Bank entry in the card');
console.log('✅ Test 3 Passed: Inside mixed requests, cash cashier only sees cash entry, bank cashier only sees bank entry!');

// --------------------------------------------------------------------------
// TEST 4: Connected Entry Accounts Isolation
// --------------------------------------------------------------------------
console.log('\nTesting Test 4: Connected Entry Accounts Isolation...');
// South cashier is only connected to entry-user-2. reqCashAwaiting is from entry-user-1.
assert.equal(
  canPaymentUserViewAwaitingRequest(southCashier, reqCashAwaiting, allUsers),
  false,
  'South cashier must NOT see requests from entry-user-1'
);

const reqSouthAwaiting = {
  id: 'req-south',
  status: 'approved',
  assigned_entry_user_id: 'entry-user-2',
  disbursement_entries: [
    {
      id: 'e-south',
      entry_no: 1,
      entry_type: 'bank',
      amount: 10000,
      status: 'approved',
      created_by: 'entry-user-2',
    },
  ],
};
assert.equal(
  canPaymentUserViewAwaitingRequest(southCashier, reqSouthAwaiting, allUsers),
  true,
  'South cashier MUST see requests from entry-user-2'
);
console.log('✅ Test 4 Passed: Connected entry account restriction strictly enforced!');

// --------------------------------------------------------------------------
// TEST 5: Settled & Paid Queue Isolation
// --------------------------------------------------------------------------
console.log('\nTesting Test 5: Settled & Paid Queue Isolation...');
// reqPaidByCashCashier was paid by cashCashier
assert.equal(
  canPaymentUserViewPaidRequest(cashCashier, reqPaidByCashCashier, allUsers),
  true,
  'Cash cashier MUST see the request they paid'
);
assert.equal(
  canPaymentUserViewPaidRequest(bankCashier, reqPaidByCashCashier, allUsers),
  false,
  'Bank cashier must NOT see request paid by Cash cashier'
);
assert.equal(
  canPaymentUserViewPaidRequest(otherCashier, reqPaidByCashCashier, allUsers),
  false,
  'Other cashier must NOT see request paid by Cash cashier'
);

// reqPaidByOtherCashier was paid by otherCashier
assert.equal(
  canPaymentUserViewPaidRequest(otherCashier, reqPaidByOtherCashier, allUsers),
  true,
  'Other cashier MUST see the request they paid'
);
assert.equal(
  canPaymentUserViewPaidRequest(cashCashier, reqPaidByOtherCashier, allUsers),
  false,
  'Cash cashier must NOT see request paid by Other cashier'
);
assert.equal(
  canPaymentUserViewPaidRequest(bankCashier, reqPaidByOtherCashier, allUsers),
  false,
  'Bank cashier must NOT see request paid by Other cashier'
);
console.log('✅ Test 5 Passed: Settled & Paid queue strictly isolates payments to only associated cashier!');

// --------------------------------------------------------------------------
// TEST 6: Card Entries Isolation in Paid Requests
// --------------------------------------------------------------------------
console.log('\nTesting Test 6: Card Entries Isolation in Paid Requests...');
const reqDualPaid = {
  id: 'req-dual-paid',
  status: 'paid',
  assigned_entry_user_id: 'entry-user-1',
  disbursement_entries: [
    {
      id: 'e-dual-1',
      entry_no: 1,
      entry_type: 'cash',
      amount: 4000,
      paid_amount: 4000,
      status: 'paid',
      paid_by: 'cash-cashier-id',
      created_by: 'entry-user-1',
    },
    {
      id: 'e-dual-2',
      entry_no: 2,
      entry_type: 'bank',
      amount: 6000,
      paid_amount: 6000,
      status: 'paid',
      paid_by: 'other-cashier-id',
      created_by: 'entry-user-1',
    },
  ],
  payments: [
    { id: 'p1', entry_id: 'e-dual-1', amount: 4000, paid_by: 'cash-cashier-id', payment_mode: 'Cash' },
    { id: 'p2', entry_id: 'e-dual-2', amount: 6000, paid_by: 'other-cashier-id', payment_mode: 'NEFT' },
  ],
};

// Cash cashier should see reqDualPaid (because they paid e-dual-1)
assert.equal(canPaymentUserViewPaidRequest(cashCashier, reqDualPaid, allUsers), true);
// But Cash cashier's visible entries in the card should ONLY be e-dual-1!
const cashEntries = reqDualPaid.disbursement_entries.filter((e) =>
  isEntryAssociatedWithPaymentUser(cashCashier, e, reqDualPaid, allUsers)
);
assert.equal(cashEntries.length, 1);
assert.equal(cashEntries[0].id, 'e-dual-1');

// Other cashier should see reqDualPaid (because they paid e-dual-2)
assert.equal(canPaymentUserViewPaidRequest(otherCashier, reqDualPaid, allUsers), true);
// And Other cashier's visible entries in the card should ONLY be e-dual-2!
const otherEntries = reqDualPaid.disbursement_entries.filter((e) =>
  isEntryAssociatedWithPaymentUser(otherCashier, e, reqDualPaid, allUsers)
);
assert.equal(otherEntries.length, 1);
assert.equal(otherEntries[0].id, 'e-dual-2');

console.log('✅ Test 6 Passed: Dual-cashier paid requests isolate entries precisely to who paid them!');

console.log('\n🎉 ALL 6 COMPREHENSIVE TESTS PASSED SUCCESSFULLY! 🚀');
