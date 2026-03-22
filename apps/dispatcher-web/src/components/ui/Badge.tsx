/**
 * Badge — status indicator atom.
 */
import React from 'react';

type Color = 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'orange';

interface BadgeProps {
  color?:     Color;
  dot?:       boolean;
  children:   React.ReactNode;
  className?: string;
}

const colorClasses: Record<Color, string> = {
  green:  'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  red:    'bg-red-100 text-red-800',
  gray:   'bg-gray-100 text-gray-600',
  blue:   'bg-blue-100 text-blue-800',
  orange: 'bg-orange-100 text-orange-800',
};

const dotColors: Record<Color, string> = {
  green:  'bg-green-500',
  yellow: 'bg-yellow-500',
  red:    'bg-red-500',
  gray:   'bg-gray-400',
  blue:   'bg-blue-500',
  orange: 'bg-orange-500',
};

export function Badge({ color = 'gray', dot = false, children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        colorClasses[color],
        className,
      ].join(' ')}
    >
      {dot && (
        <span className={['h-1.5 w-1.5 rounded-full', dotColors[color]].join(' ')} />
      )}
      {children}
    </span>
  );
}

/** Convenience component for driver status dots */
export function DriverStatusBadge({ status }: { status: 'offline' | 'online' | 'busy' }) {
  const map: Record<string, { color: Color; label: string }> = {
    offline: { color: 'gray',   label: 'Offline' },
    online:  { color: 'green',  label: 'Online'  },
    busy:    { color: 'orange', label: 'Busy'    },
  };
  const { color, label } = map[status] ?? map.offline;
  return <Badge color={color} dot>{label}</Badge>;
}
