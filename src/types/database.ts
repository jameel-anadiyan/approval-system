export type AppRole = 'admin' | 'head' | 'clerk' | 'employee' | 'disbursement' | 'regional_head';

export type RequestStatus =
  | 'draft'
  | 'submitted'
  /** Employee's request waiting for their Regional Head to forward it to the clerk */
  | 'pending_regional_review'
  | 'returned'
  | 'pending_head_approval'
  | 'pending_head_review'
  | 'pending_admin_approval'
  | 'approving'
  | 'approved'
  | 'rejected'
  | 'paid'
  | 'withdrawn'
  | 'cancelled';

export type ApprovalRoute = 'A' | 'B';

export type HeadConsultationStatus = 'pending' | 'agreed' | 'disagreed';

export type FileKind = 'document' | 'voice_note';

export type RequestType = 'general' | 'discount' | 'exhibition' | 'asset' | 'asset_below_20k' | 'non_cash' | 'stock_transfer';

export type QuoteStatus = 'pending' | 'selected' | 'rejected';

export interface Shop {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A department's kind of work; each clerk handles one or more categories. */
export interface WorkCategory {
  id: string;
  department_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscountDetails {
  before_amount: number;
  after_amount: number;
  discount_amount?: number;
  discount_pct?: number;
  customer_name?: string | null;
  reference?: string | null;
  invoice_no?: string | null;
  bill_date?: string | null;
}

export type ExhibitionProvide =
  | 'stall_space' | 'table_chairs' | 'electricity_lights' | 'logo_stage_banners'
  | 'stage_announcements' | 'social_media' | 'other';

export interface ExhibitionDetails {
  event_name: string;
  organiser_contact?: string | null;
  venue: string;
  event_dates: string;
  /** datetime-local values, e.g. "2026-11-12T10:00" */
  event_start?: string | null;
  event_end?: string | null;
  expected_footfall?: string | null;
  stall_size_location?: string | null;
  amount_excl_gst: number;
  gst_pct: number;
  gst_amount?: number;
  total_incl_gst?: number;
  payment_mode_due?: string | null;
  organiser_gstin?: string | null;
  gst_invoice?: boolean;
  provides?: ExhibitionProvide[];
  provides_other?: string | null;
  voucher_1000_qty?: number | null;
  voucher_500_qty?: number | null;
  voucher_1000_min?: number | null;
  voucher_500_min?: number | null;
  voucher_validity?: string | null;
  lucky_draw?: string | null;
  winners_draw?: string | null;
  other_costs?: number | null;
  total_budget?: number | null;
  purpose?: string | null;
  is_waitlist?: boolean;
}

export interface GeneralDetails {
  base_amount?: number | null;
  has_gst?: boolean | null;
  gst_rate?: number | null;
  gst_amount?: number | null;
  total_amount?: number | null;
}

export interface AssetDetails {
  asset_name: string;
  quantity?: string | null;
  specification?: string | null;
  purpose?: string | null;
}

export interface StockTransferItem {
  barcode: string;
  sku: string;
  mrp: number;
  gross_weight: number;
  category_id?: string | null;
  category_name?: string | null;
}

export interface StockTransferDetails {
  transfer_mode: 'itemized' | 'bulk';
  from_shop_id: string;
  from_shop_name?: string | null;
  to_shop_id: string;
  to_shop_name?: string | null;
  items?: StockTransferItem[];
  pieces_count?: number;
  category_id?: string | null;
  category_name?: string | null;
  total_pieces?: number;
  total_gross_weight?: number;
  total_mrp?: number;
  notes?: string | null;
}

export interface NonCashDetails {
  associated_value?: number | null;
  associated_notes?: string | null;
}

/** Shop picked on General / Non-Cash requests (moved to requests.shop_id by the server). */
export interface RequestShopChoice {
  shop_id?: string | null;
  shop_name?: string | null;
}

export type DisbursementMode = 'cash' | 'bank' | null;

export interface BankAccountDetails {
  disbursement_mode?: DisbursementMode | null;
  enter_bank_details_later?: boolean;
  bank_account_no?: string | null;
  bank_ifsc?: string | null;
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_account_holder_name?: string | null;
  bank_verified?: boolean;
  bank_verification_message?: string | null;
}

export const isDisbursementAssociated = (type?: RequestType | string | null): boolean =>
  Boolean(type && type !== 'discount' && type !== 'non_cash' && type !== 'stock_transfer');

export type RequestDetails = Partial<DiscountDetails> & Partial<ExhibitionDetails> & Partial<GeneralDetails>
  & Partial<AssetDetails> & Partial<StockTransferDetails> & Partial<NonCashDetails> & RequestShopChoice
  & Partial<BankAccountDetails>;

export interface Department {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Region {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  designation: string | null;
  role: AppRole;
  department_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  department?: Department;
  shop_id?: string | null;
  allowed_types?: RequestType[];
  shop?: Shop | null;
  /** Head only — granted by Admin to open the Discount Report */
  can_view_discount_report?: boolean;
  /** Head only — granted by Admin to view and decide the Special Waiting List tab */
  can_view_exhibition_waitlist?: boolean;
  photo_path?: string | null;
  /** Regional Head only — assigned region from Region Master */
  region_id?: string | null;
  region?: Region | null;
  /** Employee only — the Regional Head their requests go through */
  regional_head_id?: string | null;
  /** Regional Head only — shops they cover */
  rh_shops?: { shop_id: string }[];
  /** Clerk only — work categories they handle */
  clerk_cats?: { category_id: string }[];
  /** Default assigned Head for employee / regional head */
  default_head_id?: string | null;
  /** Heads assigned to this employee / regional head */
  user_heads?: { head_id: string; is_default: boolean }[];
  /** Disbursement role only: Entry Only vs Payment Only vs Stock Transfer Monitor vs Entry Approver */
  disbursement_type?: DisbursementAccountType | null;
  /** Granted by Admin to open the Stock Transfer Report (Admin / Monitor always have it) */
  can_view_stock_transfer_report?: boolean;
  /** Payment Only accounts: cash dealer, bank dealer, or both */
  payment_dealer_type?: PaymentDealerType | null;
  /** Payment Only accounts: connected entry account mappings */
  connected_entry_accounts?: ConnectedEntryAccount[];
  /** Department Head: whether consultation with a designated head is mandatory before approval/forwarding */
  mandatory_head_consultation?: boolean;
  mandatory_consultation_head_id?: string | null;
  mandatory_consultation_head_name?: string | null;
}

export interface ConnectedEntryAccount {
  entry_user_id: string;
  entry_user_name?: string;
}

export type DisbursementAccountType = 'entry_only' | 'payment_only' | 'stock_transfer_monitor' | 'entry_approver';

export type PaymentDealerType = 'cash' | 'bank' | 'both';

/** A shop the signed-in user may tag a General / Non-Cash request with. */
export interface RequestShopOption {
  id: string;
  name: string;
  code: string;
  /** true = user's own / covered shop; false = user has none, so any active shop is offered */
  associated: boolean;
}

export interface UserTargetHead {
  head_id: string;
  head_name: string;
  department_id: string;
  department_name: string;
  is_default: boolean;
}

export interface ApproverCredential {
  user_id: string;
  seal_path: string | null;
  signature_path: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  seal_url?: string;
  signature_url?: string;
}

export interface RequestRecord {
  id: string;
  request_no: string | null;
  requester_id: string;
  requester_name: string;
  requester_role: AppRole;
  department_id: string;
  title: string;
  notes: string | null;
  amount: number;
  status: RequestStatus;
  route: ApprovalRoute | null;
  routed_by: string | null;
  routed_at: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  approval_no: string | null;
  decided_by: string | null;
  decided_at: string | null;
  approver_role: AppRole | null;
  approver_name?: string | null;
  verify_token: string | null;
  approving_by: string | null;
  approving_started_at: string | null;
  status_before_approving: RequestStatus | null;
  paid_by: string | null;
  paid_at: string | null;
  payment_mode: string | null;
  payment_ref: string | null;
  payment_remarks: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  department?: Department;
  request_type?: RequestType;
  shop_id?: string | null;
  shop_name?: string | null;
  details?: RequestDetails | null;
  files?: RequestFile[];
  signed_files?: SignedFile[];
  actions?: RequestAction[];
  /** Total disbursed so far (partial payments add up until it equals amount) */
  paid_amount?: number;
  payments?: RequestPayment[];
  consultations?: HeadConsultation[];
  requester?: Pick<Profile, 'id' | 'full_name' | 'designation' | 'photo_path'> | null;
  requester_photo_path?: string | null;
  owner_head_id?: string | null;
  owner_head_name?: string | null;
  owner_head?: Pick<Profile, 'id' | 'full_name' | 'designation' | 'photo_path'> | null;
  disbursement_clarifications?: DisbursementClarification[];
  /** Set when the owner Head cancelled the approval before it was fully paid */
  cancelled_by?: string | null;
  cancelled_by_name?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  /** Asset buying: the quotation chosen by the Head (or Admin) */
  selected_quote_id?: string | null;
  quote_selected_by?: string | null;
  quote_selected_by_name?: string | null;
  quote_selected_at?: string | null;
  /** Work category picked by the requester (decides which clerk gets it) */
  category_id?: string | null;
  category_name?: string | null;
  /** Regional Head the employee's request went through */
  regional_head_id?: string | null;
  regional_head_name?: string | null;
  regional_forwarded_at?: string | null;
  /** Computed: clerks who may route / return this request */
  routing_clerk_ids?: string[] | null;
  /** Regional Head's region */
  region_id?: string | null;
  region_name?: string | null;
  /** Special Waiting List Exhibition flag */
  is_waitlist?: boolean;
  waitlist_approved_by?: string | null;
  waitlist_approved_at?: string | null;
  /** Assigned Entry Only account for payment-needed requests */
  assigned_entry_user_id?: string | null;
  assigned_entry_user_name?: string | null;
  assigned_entry_at?: string | null;
  assigned_entry_by?: string | null;
  /** Disbursement entries (for entry-only / payment-only accounts) */
  disbursement_entries?: DisbursementEntry[];
  /** Stock transfer: marked complete by the Stock Transfer Monitor account (or Admin) */
  transfer_completed_at?: string | null;
  transfer_completed_by?: string | null;
  transfer_completed_by_name?: string | null;
  transfer_completed_remarks?: string | null;
  /** Disbursement mode: cash or bank */
  disbursement_mode?: DisbursementMode | null;
  enter_bank_details_later?: boolean;
  bank_account_no?: string | null;
  bank_ifsc?: string | null;
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_account_holder_name?: string | null;
  bank_verified?: boolean;
  bank_verification_message?: string | null;
  /** Bill Missing workflow */
  is_bill_missing?: boolean;
  bill_missing_note?: string | null;
  bill_missing_at?: string | null;
  bill_missing_by?: string | null;
  bill_missing_by_name?: string | null;
  bill_missing_status?: 'missing' | 'submitted' | 'received' | null;
  bill_submitted_at?: string | null;
  bill_submitted_by?: string | null;
  bill_submitted_by_name?: string | null;
  bill_submitted_note?: string | null;
  bill_submitted_file_path?: string | null;
  bill_submitted_file_name?: string | null;
  bill_received_at?: string | null;
  bill_received_by?: string | null;
  bill_received_by_name?: string | null;
}

export type DisbursementEntryStatus = 'pending' | 'pending_approval' | 'approved' | 'rejected' | 'paid' | 'cancelled' | 'on_hold';

export interface DisbursementEntry {
  id: string;
  request_id: string;
  entry_no: number;
  amount: number;
  entry_type: 'cash' | 'bank';
  tds_cut: boolean;
  status: DisbursementEntryStatus;
  notes?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  rejected_by_name?: string | null;
  rejection_reason?: string | null;
  held_at?: string | null;
  held_by?: string | null;
  held_by_name?: string | null;
  hold_reason?: string | null;
  paid_at?: string | null;
  paid_by?: string | null;
  paid_by_name?: string | null;
  payment_id?: string | null;
  /** Old balance / old advance adjusted with this entry (separate from the entry amount, auto-settled, not paid by Payment-Only) */
  adjustment_amount?: number;
  adjustment_payment_id?: string | null;
  updated_at?: string | null;
  /** TDS amount deducted from the request balance (settled with the entry's first payment) */
  tds_amount?: number;
  tds_settled?: boolean;
  /** Amount the Entry Approver cleared for payment (full outstanding, or a partial figure) */
  approved_amount?: number | null;
  /** Cash already paid out against this entry */
  paid_amount?: number;
  /** Person (name + passkey) who made the entry / who paid it */
  created_by_person_id?: string | null;
  created_by_person_name?: string | null;
  paid_by_person_id?: string | null;
  paid_by_person_name?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Part of an entry that is still to be paid out (entry amount - cash already paid). */
export const entryOutstanding = (e: Pick<DisbursementEntry, 'amount' | 'paid_amount'>) =>
  Math.max(0, round2(Number(e.amount || 0) - Number(e.paid_amount || 0)));

/**
 * Exact amount the Payment-Only account must pay for an entry = what the Entry Approver approved
 * (full outstanding, or the partial figure). Nothing is payable until the entry is approved.
 */
export const entryPayable = (
  e: Pick<DisbursementEntry, 'amount' | 'paid_amount' | 'approved_amount' | 'status'>
) => {
  if (e.status !== 'approved' && e.status !== 'pending') return 0;
  const outstanding = entryOutstanding(e);
  const approved = e.approved_amount;
  if (approved === null || approved === undefined || Number(approved) <= 0) return outstanding;
  return Math.min(outstanding, Math.max(0, round2(Number(approved))));
};

/** True when part of the entry has been paid and the rest is waiting for the verifier. */
export const entryHasBalanceAwaitingApproval = (
  e: Pick<DisbursementEntry, 'amount' | 'paid_amount' | 'status'>
) => (e.status === 'pending_approval' || e.status === 'pending') && Number(e.paid_amount || 0) > 0 && entryOutstanding(e) > 0;

/** Entry amount + TDS + adjustment of all live entries. */
export const entriesTotal = (entries: DisbursementEntry[] = []) =>
  round2(
    entries
      .filter((e) => e.status !== 'cancelled')
      .reduce(
        (s, e) => s + Number(e.amount || 0) + Number(e.adjustment_amount || 0) + Number(e.tds_amount || 0),
        0
      )
  );

/**
 * Balance still available for new entries (entry amount + TDS + adjustment):
 * request amount - already paid/adjusted - cash still to be paid on live entries
 * - TDS of live entries not yet deducted.
 */
export const entryAvailable = (
  r: { amount?: number | null; paid_amount?: number | null; disbursement_entries?: DisbursementEntry[] | null }
) => {
  const reserved = (r.disbursement_entries || [])
    .filter((e) => e.status === 'pending' || e.status === 'pending_approval' || e.status === 'approved' || e.status === 'on_hold')
    .reduce((s, e) => s + entryOutstanding(e) + (e.tds_settled ? 0 : Number(e.tds_amount || 0)), 0);
  return Math.max(0, round2(Number(r.amount || 0) - Number(r.paid_amount || 0) - reserved));
};

export type DisbursementClarificationStatus = 'pending_head' | 'clarified';

export interface DisbursementClarification {
  id: string;
  request_id: string;
  requested_by: string;
  requested_by_name: string;
  head_id: string;
  head_name: string;
  request_note?: string | null;
  request_voice_path?: string | null;
  request_voice_duration?: number | null;
  responded_by?: string | null;
  responded_by_name?: string | null;
  response_note?: string | null;
  response_voice_path?: string | null;
  response_voice_duration?: number | null;
  responded_at?: string | null;
  status: DisbursementClarificationStatus;
  created_at: string;
  updated_at: string;
}

export interface HeadConsultation {
  id: string;
  request_id: string;
  requested_by: string;
  requested_by_name: string;
  head_id: string;
  head_name: string;
  department_id?: string | null;
  department_name?: string | null;
  status: HeadConsultationStatus;
  request_note?: string | null;
  request_voice_path?: string | null;
  request_voice_duration?: number | null;
  response_remarks?: string | null;
  response_voice_path?: string | null;
  response_voice_duration?: number | null;
  responded_at?: string | null;
  created_at: string;
  head_photo_path?: string | null;
  head?: Pick<Profile, 'id' | 'full_name' | 'designation' | 'photo_path'> | null;
}

export interface RequestPayment {
  id: string;
  request_id: string;
  amount: number;
  payment_date: string;
  payment_mode: string | null;
  payment_ref: string | null;
  remarks: string | null;
  paid_by: string | null;
  paid_by_name: string | null;
  /** Person (name + passkey) at the Payment account who made the payment */
  paid_by_person_name?: string | null;
  created_at: string;
  entry_id?: string | null;
  /** Auto-recorded old balance / old advance adjustment / TDS deduction (not a real payout) */
  is_adjustment?: boolean;
  /** Optional document uploaded during payment for future reference / audit */
  document_storage_path?: string | null;
  document_name?: string | null;
}

/** Paid so far, balance left, and whether some (but not all) has been paid. */
export function paymentSummary(r: Pick<RequestRecord, 'amount' | 'paid_amount' | 'status'>) {
  const paid = r.status === 'paid' ? Math.max(Number(r.paid_amount ?? 0), Number(r.amount)) : Number(r.paid_amount ?? 0);
  const balance = Math.max(0, Math.round((Number(r.amount) - paid) * 100) / 100);
  return { paid, balance, partial: paid > 0 && balance > 0 };
}

export interface RequestFile {
  id: string;
  request_id: string;
  kind: FileKind;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  duration_sec: number | null;
  sha256: string | null;
  created_at: string;
  public_url?: string;
  /** Set when a Clerk / Head / Admin added this voice note while acting on the request */
  added_by?: string | null;
  added_by_name?: string | null;
  added_by_role?: AppRole | null;
  /** Set when a Head attached this document while answering a Disbursement clarification */
  clarification_id?: string | null;
  /** Asset buying quotations: typed by the requester against each quotation document */
  quote_vendor?: string | null;
  quote_amount?: number | null;
  quote_preferred?: boolean;
  quote_status?: QuoteStatus | null;
  /** Client-only: the picked/recorded file awaiting upload to Storage */
  blob?: Blob;
}

export interface SignedFile {
  id: string;
  request_id: string;
  source_file_id: string | null;
  is_packet?: boolean;
  file_name?: string;
  storage_path: string;
  sha256: string;
  page_count: number;
  created_at: string;
  download_url?: string;
}

export interface RequestAction {
  id: string;
  request_id: string;
  actor_id: string;
  actor_name: string;
  actor_role: AppRole;
  action: string;
  from_status: RequestStatus | null;
  to_status: RequestStatus;
  remarks: string | null;
  visible_to_requester: boolean;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  request_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface AppSettings {
  high_value_threshold: number;
  approval_prefix: string;
  request_prefix: string;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}
