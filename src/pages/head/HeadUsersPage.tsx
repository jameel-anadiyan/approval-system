import React from 'react';
import { Users } from 'lucide-react';
import { StaffManager } from '../../components/admin/StaffManager';

export const HeadUsersPage: React.FC = () => (
  <StaffManager
    title="Department Staff"
    subtitle="Create and manage Clerk and Employee logins for your department."
    icon={Users}
    roles={['clerk', 'employee']}
    addLabel="Add Staff Member"
  />
);
