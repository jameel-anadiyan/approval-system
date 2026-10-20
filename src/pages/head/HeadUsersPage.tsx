import React from 'react';
import { Users } from 'lucide-react';
import { StaffManager } from '../../components/admin/StaffManager';

export const HeadUsersPage: React.FC = () => (
  <StaffManager
    title="Department Staff"
    subtitle="Create and manage Clerk, Regional Head and Employee logins for your department, and split the clerks' work by category."
    icon={Users}
    roles={['clerk', 'regional_head', 'employee']}
    addLabel="Add Staff Member"
    manageCategories
  />
);
