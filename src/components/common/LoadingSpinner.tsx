import React from 'react';

interface LoadingSpinnerProps {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ label = 'Loading…', size = 'md' }) => {
  const sizes = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 gap-3 text-slate-500">
      <div
        className={`${sizes[size]} rounded-full border-indigo-200 border-t-indigo-600 animate-spin`}
      />
      {label && <p className="text-sm font-medium text-slate-600">{label}</p>}
    </div>
  );
};
