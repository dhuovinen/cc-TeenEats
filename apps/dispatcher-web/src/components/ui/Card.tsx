/**
 * Card — layout container atom.
 */
import React from 'react';

interface CardProps {
  title?:     string;
  children:   React.ReactNode;
  className?: string;
  footer?:    React.ReactNode;
}

export function Card({ title, children, className = '', footer }: CardProps) {
  return (
    <div className={['rounded-lg border border-gray-200 bg-white shadow-sm', className].join(' ')}>
      {title && (
        <div className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
      {footer && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 rounded-b-lg">
          {footer}
        </div>
      )}
    </div>
  );
}
