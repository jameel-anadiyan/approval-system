import React from 'react';
import { Users } from 'lucide-react';
import { StaffManager } from '../../components/admin/StaffManager';

export const AdminStaffPage: React.FC = () => (
  <StaffManager
    title="Staff &amp; Employees Master"
    subtitle="View and manage all employee logins across departments and stores, including identification photos and access rules."
    icon={Users}
    roles={['employee', 'regional_head', 'clerk', 'head', 'disbursement']}
    addLabel="Add Staff Member"
    showCredentials
    manageCategories
  />
);
