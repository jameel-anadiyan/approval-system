import React from 'react';
import { Globe } from 'lucide-react';
import { StaffManager } from '../../components/admin/StaffManager';

export const AdminRegionalHeadsPage: React.FC = () => (
  <StaffManager
    title="Regional Heads Master"
    subtitle="Configure Regional Heads, assign their Region from Region Master, and manage shop coverage & exhibition access."
    icon={Globe}
    roles={['regional_head']}
    addLabel="Add Regional Head"
    showCredentials
  />
);
