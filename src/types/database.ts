export type AppRole = 'admin' | 'head' | 'clerk' | 'employee' | 'disbursement';

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'returned'
  | 'pending_head_approval'
  | 'pending_head_review'
  | 'pending_admin_approval'
  | 'approving'
  | 'approved'
  | 'rejected'
  | 'paid'
  | 'withdrawn';

export type ApprovalRoute = 'A' | 'B';

export type FileKind = 'document' | 'voice_note';

export interface Department {
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
  approval_no: string | null;
  decided_by: string | null;
  decided_at: string | null;
  approver_role: AppRole | null;
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
  files?: RequestFile[];
  signed_files?: SignedFile[];
  actions?: RequestAction[];
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
}

export interface SignedFile {
  id: string;
  request_id: string;
  source_file_id: string | null;
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
