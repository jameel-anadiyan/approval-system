import React from 'react';
import { Wallet } from 'lucide-react';
import { StaffManager } from '../../components/admin/StaffManager';

export const AdminDisbursementPage: React.FC = () => (
  <StaffManager
    title="Disbursement Users"
    subtitle="Staff who see approved requests across all departments and mark them as paid."
    icon={Wallet}
    roles={['disbursement']}
    addLabel="Add Disbursement User"
  />
);
