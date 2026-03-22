/**
 * Core domain types — shared across all TeenEats frontend apps.
 * These mirror the backend API response shapes.
 *
 * Rule: import these from here everywhere. Never define domain shapes inline.
 */

// ─── Users ────────────────────────────────────────────────────────────────────

export type UserRole = 'driver' | 'customer' | 'parent' | 'admin';

export interface User {
  id:             string;
  role:           UserRole;
  full_name:      string;
  email:          string;
  email_verified: boolean;
}

export interface DriverUser extends User {
  role:             'driver';
  status:           DriverStatus;
  state:            string;
  city:             string;
  consent_approved: boolean;
  safety_score:     number | null;
}

export interface ParentUser extends User {
  role:           'parent';
  linked_drivers: Array<{ driver_user_id: string; driver_name: string; consent_status: string }>;
}

export interface CustomerUser extends User {
  role: 'customer';
  phone: string | null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
}

export interface AuthState {
  tokens: AuthTokens | null;
  user:   User | null;
}

// ─── Drivers (alpha + MVP) ────────────────────────────────────────────────────

export type DriverStatus = 'offline' | 'online' | 'busy';

export interface Driver {
  id:           string;
  name:         string;
  email:        string;
  status:       DriverStatus;
  safety_score: number | null;
  created_at:   string;
}

export interface ScoreBreakdown {
  overall:          number | null;
  acceptance:       number;
  onTime:           number;
  completion:       number;
  totalDeliveries:  number;
}

// ─── Deliveries (alpha) ───────────────────────────────────────────────────────

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'active'
  | 'completed'
  | 'timed_out'
  | 'cancelled';

export interface Delivery {
  id:                 string;
  pickup_address:     string;
  pickup_lat:         number;
  pickup_lng:         number;
  dropoff_address:    string;
  dropoff_lat:        number;
  dropoff_lng:        number;
  item_description:   string;
  status:             DeliveryStatus;
  driver_id:          string | null;
  timeout_seconds:    number;
  estimated_minutes:  number;
  created_at:         string;
  accepted_at:        string | null;
  completed_at:       string | null;
  cancelled_at:       string | null;
  timed_out_at:       string | null;
}

// ─── Real-time ────────────────────────────────────────────────────────────────

export interface DriverLocation {
  deliveryId: string;
  driverId:   string;
  lat:        number;
  lng:        number;
  ts:         string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  request_timeout_seconds: string;
}
