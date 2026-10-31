import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { AppRole, Department, DisbursementAccountType, Profile, Region, RequestType, Shop, WorkCategory } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { UserPlus, ShieldAlert, Camera, Trash2, Wallet, Users, Plus } from 'lucide-react';
import { AccessFields, ExtraAccess, coveringRegionalHeads, rolesWithTypes, validateAccess } from './AccessFields';
import { compressAvatar } from '../../lib/imageUtils';
import { ROLE_LABELS } from '../../lib/formatters';
import { AccountPersonInput } from '../../lib/directory';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  departments: Department[];
  shops?: Shop[];
  regions?: Region[];
  /** Existing users (to list Regional Heads for a new employee) */
  users?: Profile[];
  categories?: WorkCategory[];
  allowedRoles?: AppRole[];
  onCreateUser: (data: {
    username: string;
    full_name: string;
    designation?: string;
    role: AppRole;
    department_id?: string | null;
    password?: string;
    shop_id?: string | null;
    allowed_types?: RequestType[];
    photo?: string;
    shop_ids?: string[];
    region_id?: string | null;
    category_ids?: string[];
    regional_head_id?: string | null;
    head_ids?: string[];
    default_head_id?: string | null;
    disbursement_type?: DisbursementAccountType | null;
    payment_dealer_type?: 'cash' | 'bank' | 'both' | null;
    connected_entry_accounts?: string[];
    mandatory_head_consultation?: boolean;
    mandatory_consultation_head_id?: string | null;
    account_persons?: AccountPersonInput[];
    whatsapp_number?: string | null;
  }) => Promise<{ success: boolean; error?: string }>;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  departments,
  shops = [],
  regions = [],
  users = [],
  categories = [],
  allowedRoles = ['head', 'clerk', 'employee', 'disbursement'],
  onCreateUser,
}) => {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [role, setRole] = useState<AppRole>(allowedRoles[0] || 'employee');
  const [disbursementType, setDisbursementType] = useState<DisbursementAccountType>('entry_only');
  const [paymentDealerType, setPaymentDealerType] = useState<'cash' | 'bank' | 'both'>('both');
  const [connectedEntryAccounts, setConnectedEntryAccounts] = useState<string[]>([]);
  const [mandatoryHeadConsultation, setMandatoryHeadConsultation] = useState(false);
  const [mandatoryConsultationHeadId, setMandatoryConsultationHeadId] = useState('');
  const [accountPersons, setAccountPersons] = useState<AccountPersonInput[]>([
    { name: '', passkey: '' },
  ]);

  React.useEffect(() => {
    if (isOpen) {
      if (allowedRoles.length > 0 && (!allowedRoles.includes(role) || allowedRoles.length === 1)) {
        setRole(allowedRoles[0]);
      }
      setDisbursementType('entry_only');
      setPaymentDealerType('both');
      setConnectedEntryAccounts([]);
      setMandatoryHeadConsultation(false);
      setMandatoryConsultationHeadId('');
      setAccountPersons([{ name: '', passkey: '' }]);
      setWhatsappNumber('');
    }
  }, [isOpen, allowedRoles]);

  const [departmentId, setDepartmentId] = useState<string>(
    user?.department_id || departments[0]?.id || ''
  );
  const [shopId, setShopId] = useState('');
  const [types, setTypes] = useState<RequestType[]>(['general']);

  const initialHeadId =
    user?.role === 'head'
      ? user.id
      : (users.find((u) => u.role === 'head' && u.department_id === (user?.department_id || departments[0]?.id))?.id ||
         users.find((u) => u.role === 'head')?.id ||
         '');

  const [extra, setExtra] = useState<ExtraAccess>({
    shopIds: [],
    regionId: '',
    regionalHeadId: '',
    categoryIds: [],
    headIds: initialHeadId ? [initialHeadId] : [],
    defaultHeadId: initialHeadId,
  });
  const [password, setPassword] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file, 400, 0.85);
      setPhoto(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid image file');
    } finally {
      e.target.value = '';
    }
  };

  const isDepartmentRequired = role === 'head' || role === 'clerk' || role === 'employee' || role === 'regional_head';
  const covering = role === 'employee' ? coveringRegionalHeads(users, departmentId, shopId) : [];
  // A Regional Head picked for another shop no longer applies.
  const regionalHeadId = covering.some((u) => u.id === extra.regionalHeadId) ? extra.regionalHeadId : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      setError('Username must be 3–30 characters, lowercase letters, digits, dot, dash, or underscore.');
      return;
    }

    if (password.length < 8) {
      setError('Initial password must be at least 8 characters long.');
      return;
    }

    if (role === 'head' && mandatoryHeadConsultation && !mandatoryConsultationHeadId) {
      setError('Please choose the mandatory Department Head required for consultation.');
      return;
    }

    const accessErr = validateAccess(role, shopId, types, { ...extra, regionalHeadId, coveringCount: covering.length });
    if (accessErr) {
      setError(accessErr);
      return;
    }

    if (role === 'disbursement' && (disbursementType === 'entry_only' || disbursementType === 'payment_only')) {
      const trimmedPersons = accountPersons.map((p) => ({
        name: p.name.trim(),
        passkey: p.passkey.trim(),
      }));
      if (trimmedPersons.length === 0 || trimmedPersons.some((p) => !p.name)) {
        setError('Please enter the name of at least one authorized person for this disbursement account.');
        return;
      }
      for (const p of trimmedPersons) {
        if (!/^\d{4}$/.test(p.passkey)) {
          setError(`Passkey for "${p.name}" must be exactly 4 digits.`);
          return;
        }
      }
      const namesLower = trimmedPersons.map((p) => p.name.toLowerCase());
      if (new Set(namesLower).size !== namesLower.length) {
        setError('Each authorized person must have a unique name on this account.');
        return;
      }
      const passkeys = trimmedPersons.map((p) => p.passkey);
      if (new Set(passkeys).size !== passkeys.length) {
        setError('Each authorized person must have a distinct 4-digit passkey on this account.');
        return;
      }
    }

    const withTypes = rolesWithTypes.includes(role);

    setIsSubmitting(true);
    try {
      const defaultHead = extra.defaultHeadId || (extra.headIds.length > 0 ? extra.headIds[0] : null);
      const res = await onCreateUser({
        username: cleanUsername,
        full_name: fullName.trim(),
        designation: designation.trim() || undefined,
        whatsapp_number: whatsappNumber.trim() || undefined,
        role,
        department_id: isDepartmentRequired ? departmentId : null,
        password,
        shop_id: withTypes && role !== 'regional_head' ? shopId || null : null,
        allowed_types: withTypes ? types : undefined,
        photo: photo || undefined,
        ...(role === 'regional_head' ? { shop_ids: extra.shopIds, region_id: extra.regionId || null } : {}),
        ...(role === 'head'
          ? {
              region_id: extra.regionId || null,
              mandatory_head_consultation: mandatoryHeadConsultation,
              mandatory_consultation_head_id: mandatoryHeadConsultation ? mandatoryConsultationHeadId || null : null,
            }
          : {}),
        ...(role === 'clerk' ? { category_ids: extra.categoryIds } : {}),
        ...(role === 'employee' ? { regional_head_id: regionalHeadId || null } : {}),
        ...(role === 'employee' || role === 'regional_head'
          ? { head_ids: extra.headIds, default_head_id: defaultHead }
          : {}),
        ...(role === 'disbursement'
          ? {
              disbursement_type: disbursementType,
              payment_dealer_type: disbursementType === 'payment_only' ? paymentDealerType : null,
              connected_entry_accounts: disbursementType === 'payment_only' ? connectedEntryAccounts : [],
              account_persons:
                disbursementType === 'entry_only' || disbursementType === 'payment_only'
                  ? accountPersons.map((p) => ({ name: p.name.trim(), passkey: p.passkey.trim() }))
                  : undefined,
            }
          : {}),
      });

      if (res.success) {
        setUsername('');
        setFullName('');
        setDesignation('');
        setWhatsappNumber('');
        setShopId('');
        setTypes(['general']);
        setAccountPersons([{ name: '', passkey: '' }]);
        setExtra({
          shopIds: [],
          regionId: '',
          regionalHeadId: '',
          categoryIds: [],
          headIds: initialHeadId ? [initialHeadId] : [],
          defaultHeadId: initialHeadId,
        });
        setPhoto(null);
        onClose();
      } else {
        setError(res.error || 'Failed to create user account.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDisbursementRole = role === 'disbursement' || (allowedRoles.length === 1 && allowedRoles[0] === 'disbursement');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isDisbursementRole ? "Create Disbursement Account" : "Create Staff Account"}
      description={
        isDisbursementRole
          ? "Create a login credential for Disbursement staff with either Entry Only or Payment Only permissions."
          : "Create a new login credential. The user will be required to change their password on first sign in."
      }
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Employee Profile Photo Selector */}
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-2xl overflow-hidden bg-slate-200 border-2 border-white shadow-xs flex items-center justify-center font-bold text-slate-500 font-display text-lg">
              {photo ? (
                <img src={photo} alt="Avatar Preview" className="w-full h-full object-cover" />
              ) : (
                fullName.trim() ? fullName.trim().charAt(0).toUpperCase() : <Camera className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-xs transition-transform active:scale-95"
              title="Upload photo"
            >
              <Camera className="w-3 h-3" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">Employee Photo</span>
              {photo && (
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Portrait photo for requests &amp; approval sheets.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoSelect}
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Full Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Anand Kumar"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Username <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="e.g. anand_k"
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
            />
            <span className="absolute right-3 top-3 text-[11px] text-slate-400 font-mono">
              @users
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Used to log in. No email address is exposed to the user.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Portal Role <span className="text-rose-500">*</span>
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden capitalize bg-white"
            >
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Designation
            </label>
            <input
              type="text"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. Senior Officer"
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            WhatsApp Number
          </label>
          <input
            type="tel"
            maxLength={25}
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            placeholder="e.g. +91 98765 43210 or 9876543210"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">
            Approved documents and approval messages will be delivered to this WhatsApp number automatically.
          </span>
        </div>

        {isDepartmentRequired && (
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Department <span className="text-rose-500">*</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={user?.role === 'head'}
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white disabled:bg-slate-100"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>
        )}

        {role === 'disbursement' && (
          <div className="p-3.5 rounded-xl border border-sky-200 bg-sky-50/50 space-y-2">
            <label className="text-xs font-bold text-sky-900 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-sky-600" />
              <span>Disbursement Account Type</span>
              <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                disbursementType === 'entry_only'
                  ? 'bg-sky-600/10 border-sky-500 ring-1 ring-sky-500'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="disbursement_type"
                  value="entry_only"
                  checked={disbursementType === 'entry_only'}
                  onChange={() => setDisbursementType('entry_only')}
                  className="mt-0.5 text-sky-600 focus:ring-sky-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Entry Only</span>
                  <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                    Creates payment entries with automatic numbering (Entry #1, #2...) and TDS status. Cannot record payment.
                  </span>
                </div>
              </label>

              <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                disbursementType === 'payment_only'
                  ? 'bg-emerald-600/10 border-emerald-500 ring-1 ring-emerald-500'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="disbursement_type"
                  value="payment_only"
                  checked={disbursementType === 'payment_only'}
                  onChange={() => setDisbursementType('payment_only')}
                  className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Payment Only</span>
                  <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                    Pays amount strictly against approved entries (max = entry amount). Cannot create entries.
                  </span>
                </div>
              </label>

              <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                disbursementType === 'entry_approver'
                  ? 'bg-amber-600/10 border-amber-500 ring-1 ring-amber-500'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="disbursement_type"
                  value="entry_approver"
                  checked={disbursementType === 'entry_approver'}
                  onChange={() => setDisbursementType('entry_approver')}
                  className="mt-0.5 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Entry Approver</span>
                  <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                    Reviews all entries made by Entry accounts with cash/bank &amp; details. Can approve (routes to payment) or reject (sends for entry correction).
                  </span>
                </div>
              </label>

              <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                disbursementType === 'stock_transfer_monitor'
                  ? 'bg-indigo-600/10 border-indigo-500 ring-1 ring-indigo-500'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="disbursement_type"
                  value="stock_transfer_monitor"
                  checked={disbursementType === 'stock_transfer_monitor'}
                  onChange={() => setDisbursementType('stock_transfer_monitor')}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Stock Transfer Monitor</span>
                  <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                    Sees only approved stock transfers and marks them as Transfer Completed. Can view the Stock Transfer Report. No payment access.
                  </span>
                </div>
              </label>
            </div>

            {disbursementType === 'payment_only' && (
              <div className="pt-3 border-t border-sky-200/80 space-y-3">
                <div>
                  <label className="text-xs font-bold text-sky-950 block mb-1.5">
                    Payment Dealer Mode <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'both', label: 'Cash & Bank', desc: 'Both modes' },
                      { id: 'cash', label: 'Cash Only', desc: 'Settle / cash pay' },
                      { id: 'bank', label: 'Bank Only', desc: 'Bank transfer' },
                    ].map((m) => (
                      <label
                        key={m.id}
                        className={`flex flex-col p-2.5 rounded-xl border cursor-pointer transition-all text-center ${
                          paymentDealerType === m.id
                            ? 'bg-emerald-600/10 border-emerald-500 ring-1 ring-emerald-500'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="payment_dealer_type"
                          value={m.id}
                          checked={paymentDealerType === m.id}
                          onChange={() => setPaymentDealerType(m.id as 'cash' | 'bank' | 'both')}
                          className="sr-only"
                        />
                        <span className="text-xs font-bold text-slate-800">{m.label}</span>
                        <span className="text-[10px] text-slate-500 mt-0.5">{m.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-sky-950 block mb-1">
                    Connected Entry Accounts
                  </label>
                  <p className="text-[11px] text-sky-800/80 mb-2">
                    Only entries made by selected Entry Only accounts will route to this cashier (leave empty to receive from all).
                  </p>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-white rounded-xl border border-sky-200">
                    {users.filter((u) => u.role === 'disbursement' && u.disbursement_type === 'entry_only' && u.is_active).length === 0 ? (
                      <span className="text-[11px] text-slate-400 italic block p-1">No active Entry Only accounts found.</span>
                    ) : (
                      users.filter((u) => u.role === 'disbursement' && u.disbursement_type === 'entry_only' && u.is_active).map((eo) => {
                        const checked = connectedEntryAccounts.includes(eo.id);
                        return (
                          <label key={eo.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setConnectedEntryAccounts((prev) =>
                                  checked ? prev.filter((id) => id !== eo.id) : [...prev, eo.id]
                                )
                              }
                              className="rounded-sm text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="font-medium text-slate-800">{eo.full_name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">@{eo.username}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {(disbursementType === 'entry_only' || disbursementType === 'payment_only') && (
              <div className="pt-3 border-t border-sky-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-sky-950 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-sky-600" />
                      Authorized Persons & 4-Digit Passkeys <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-[11px] text-sky-800/80 mt-0.5">
                      Each person using this shared login will enter their 4-digit passkey to record who performed the entry or payment.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAccountPersons((prev) => [...prev, { name: '', passkey: '' }])}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-sky-300 text-sky-800 hover:bg-sky-50 shadow-2xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-sky-600" />
                    <span>Add Person</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {accountPersons.map((p, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-white rounded-xl border border-sky-200/90 flex items-center gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-0.5">
                          Person #{idx + 1} Name
                        </label>
                        <input
                          type="text"
                          required
                          value={p.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAccountPersons((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, name: val } : item))
                            );
                          }}
                          placeholder="e.g. Rahul Sharma"
                          className="w-full text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden"
                        />
                      </div>

                      <div className="w-32 shrink-0">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-0.5">
                          4-Digit Passkey
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]{4}"
                          maxLength={4}
                          required
                          value={p.passkey}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setAccountPersons((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, passkey: val } : item))
                            );
                          }}
                          placeholder="••••"
                          className="w-full text-xs font-mono font-bold tracking-widest text-center px-2 py-1.5 rounded-lg border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden"
                        />
                      </div>

                      {accountPersons.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setAccountPersons((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors mt-3 cursor-pointer"
                          title="Remove person"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {role === 'head' && (
          <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={mandatoryHeadConsultation}
                onChange={(e) => {
                  setMandatoryHeadConsultation(e.target.checked);
                  if (!e.target.checked) setMandatoryConsultationHeadId('');
                }}
                className="mt-0.5 rounded-sm text-amber-600 focus:ring-amber-500"
              />
              <div>
                <span className="text-xs font-bold text-amber-950 block">
                  Mandatory Consultation with another Department Head
                </span>
                <span className="text-[11px] text-amber-800/80 block leading-tight mt-0.5">
                  This Department Head cannot approve or forward any request without the designated head&apos;s agreed consultation.
                </span>
              </div>
            </label>

            {mandatoryHeadConsultation && (
              <div className="pt-2 border-t border-amber-200/80">
                <label htmlFor="mandatory-head-select" className="text-xs font-bold text-amber-950 block mb-1">
                  Designated Head to Consult <span className="text-rose-500">*</span>
                </label>
                <select
                  id="mandatory-head-select"
                  required={mandatoryHeadConsultation}
                  value={mandatoryConsultationHeadId}
                  onChange={(e) => setMandatoryConsultationHeadId(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-amber-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden bg-white"
                >
                  <option value="">Select Department Head…</option>
                  {users
                    .filter((u) => u.role === 'head' && u.is_active)
                    .map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.full_name} (@{h.username}) — {departments.find((d) => d.id === h.department_id)?.name || 'Head'}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        )}

        <AccessFields
          role={role}
          shops={shops}
          regions={regions}
          shopId={shopId}
          onShopChange={setShopId}
          types={types}
          onTypesChange={setTypes}
          departmentId={departmentId}
          users={users}
          categories={categories}
          extra={{ ...extra, regionalHeadId }}
          onExtraChange={setExtra}
        />

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Initial Temporary Password <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">
            Min 8 characters. Must be changed on first login.
          </span>
        </div>

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all disabled:opacity-50"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create User</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
