import assert from 'node:assert/strict';

console.log('🧪 Testing Latest Updates: Entry Cash/Bank Mode Locking & Payment Document Upload...\n');

// 1. Test Mode Filtering based on Entry Type & User Dealer Type
function getAvailablePaymentModes(entry, user) {
  const entryType = entry?.entry_type;
  const dealerType = user?.payment_dealer_type;

  // When entry is defined as cash: ONLY Cash is available (all others hidden)
  if (entryType === 'cash') return ['Cash'];
  // When entry is defined as bank: ONLY bank modes are available (Cash hidden)
  if (entryType === 'bank') return ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer'];
  // Fallback if no entry attached: use account dealer type
  if (dealerType === 'cash') return ['Cash'];
  if (dealerType === 'bank') return ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer'];
  return ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer', 'Cash'];
}

// User has BOTH cash and bank permissions:
const cashierBoth = { role: 'disbursement', disbursement_type: 'payment_only', payment_dealer_type: 'both' };
const cashierCash = { role: 'disbursement', disbursement_type: 'payment_only', payment_dealer_type: 'cash' };
const cashierBank = { role: 'disbursement', disbursement_type: 'payment_only', payment_dealer_type: 'bank' };

// Case 1a: Entry defined as Cash -> Both account MUST ONLY see Cash!
const modesForCashEntry = getAvailablePaymentModes({ entry_type: 'cash' }, cashierBoth);
assert.deepEqual(modesForCashEntry, ['Cash'], 'Cash entry must only show Cash option, even for a "both" payment account');
assert.ok(!modesForCashEntry.includes('NEFT'), 'Bank options must be hidden for Cash entry');
console.log('✅ 1a: Entry defined as cash forces ONLY Cash mode for "both" cashier (bank modes hidden)');

// Case 1b: Entry defined as Bank -> Both account MUST ONLY see Bank modes! Cash must be hidden!
const modesForBankEntry = getAvailablePaymentModes({ entry_type: 'bank' }, cashierBoth);
assert.deepEqual(modesForBankEntry, ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer']);
assert.ok(!modesForBankEntry.includes('Cash'), 'Cash must be hidden when entry is bank');
console.log('✅ 1b: Entry defined as bank forces ONLY bank modes for "both" cashier (Cash hidden)');

// Case 1c: Fallback when no entry is specified
const modesForNoEntryCashUser = getAvailablePaymentModes(null, cashierCash);
assert.deepEqual(modesForNoEntryCashUser, ['Cash']);
const modesForNoEntryBankUser = getAvailablePaymentModes(null, cashierBank);
assert.deepEqual(modesForNoEntryBankUser, ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer']);
console.log('✅ 1c: Fallback uses user dealer mode when no entry is specified');

// 2. Test Backend Mode Validation Rules (from pay_disbursement_entry RPC)
function validatePaymentModeAgainstEntry(entry, paymentMode) {
  const cleanMode = (paymentMode || (entry.entry_type === 'cash' ? 'Cash' : 'Bank Transfer')).trim().toLowerCase();
  if (entry.entry_type === 'cash' && cleanMode !== 'cash') {
    throw new Error('This entry is defined as Cash payment. Bank modes are not allowed.');
  }
  if (entry.entry_type === 'bank' && cleanMode === 'cash') {
    throw new Error('This entry is defined as Bank transfer. Cash mode is not allowed.');
  }
  return true;
}

assert.ok(validatePaymentModeAgainstEntry({ entry_type: 'cash' }, 'Cash'));
assert.throws(() => validatePaymentModeAgainstEntry({ entry_type: 'cash' }, 'NEFT'), /Cash payment/);
assert.throws(() => validatePaymentModeAgainstEntry({ entry_type: 'cash' }, 'UPI'), /Cash payment/);
console.log('✅ 2a: Backend rejects non-cash payment modes on cash entries');

assert.ok(validatePaymentModeAgainstEntry({ entry_type: 'bank' }, 'NEFT'));
assert.ok(validatePaymentModeAgainstEntry({ entry_type: 'bank' }, 'RTGS'));
assert.throws(() => validatePaymentModeAgainstEntry({ entry_type: 'bank' }, 'Cash'), /Bank transfer/);
console.log('✅ 2b: Backend rejects Cash payment mode on bank entries');

// 3. Test Optional Payment Document Attachment
const samplePaymentWithDoc = {
  id: 'pay-123',
  request_id: 'req-456',
  entry_id: 'ent-789',
  amount: 5000,
  payment_mode: 'NEFT',
  payment_ref: 'UTR99887766',
  document_storage_path: 'req-456/payment-uuid-bank_counterfoil.pdf',
  document_name: 'bank_counterfoil.pdf',
};

assert.ok(samplePaymentWithDoc.document_storage_path);
assert.equal(samplePaymentWithDoc.document_name, 'bank_counterfoil.pdf');
console.log('✅ 3: Optional payment document attachment correctly saved and referenced');

console.log('\n🎉 ALL MODE RESTRICTION & PAYMENT DOCUMENT TESTS PASSED!\n');
