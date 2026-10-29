import React from 'react';
import { DocumentPreviewModal } from './DocumentPreviewModal';

interface SignedDocPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  storagePath: string | null;
  fileName: string;
  approvalNo?: string | null;
}

export const SignedDocPreviewModal: React.FC<SignedDocPreviewModalProps> = ({
  isOpen,
  onClose,
  storagePath,
  fileName,
  approvalNo,
}) => {
  return (
    <DocumentPreviewModal
      isOpen={isOpen}
      onClose={onClose}
      files={[
        {
          name: fileName,
          storagePath: storagePath,
          bucket: 'signed-documents',
          badge: approvalNo ? `Approved #${approvalNo}` : 'Official Stamped Packet',
        },
      ]}
      approvalNo={approvalNo}
      title={fileName}
    />
  );
};
