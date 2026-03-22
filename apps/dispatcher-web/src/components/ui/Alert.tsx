/**
 * Alert — inline feedback atom.
 */
import React from 'react';

type AlertVariant = 'error' | 'warning' | 'success' | 'info';

interface AlertProps {
  variant?:   AlertVariant;
  title?:     string;
  children:   React.ReactNode;
  onDismiss?: () => void;
}

const variants: Record<AlertVariant, { wrapper: string; icon: string }> = {
  error:   { wrapper: 'bg-red-50 border-red-200 text-red-800',    icon: '✕' },
  warning: { wrapper: 'bg-yellow-50 border-yellow-200 text-yellow-800', icon: '⚠' },
  success: { wrapper: 'bg-green-50 border-green-200 text-green-800',  icon: '✓' },
  info:    { wrapper: 'bg-blue-50 border-blue-200 text-blue-800',   icon: 'ℹ' },
};

export function Alert({ variant = 'info', title, children, onDismiss }: AlertProps) {
  const { wrapper, icon } = variants[variant];
  return (
    <div className={['flex items-start gap-3 rounded-md border p-3 text-sm', wrapper].join(' ')}>
      <span className="mt-0.5 shrink-0 font-bold">{icon}</span>
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-current opacity-60 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}
