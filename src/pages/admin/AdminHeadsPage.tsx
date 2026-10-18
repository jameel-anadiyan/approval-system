import React from 'react';
import { Users } from 'lucide-react';
import { StaffManager } from '../../components/admin/StaffManager';

export const AdminHeadsPage: React.FC = () => (
  <StaffManager
    title="Department Heads"
    subtitle="One active Head per department. Upload each Head's seal and signature PNGs — they are stamped on every page they approve."
    icon={Users}
    roles={['head']}
    addLabel="Appoint Head"
    showCredentials
  />
);
