/**
 * Core domain types — driver app.
 * Mirrors apps/dispatcher-web/src/types/domain.ts — keep in sync.
 */

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

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
}

export type DriverStatus = 'offline' | 'online' | 'busy';

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'active'
  | 'completed'
  | 'timed_out'
  | 'cancelled';

export interface Delivery {
  id:                string;
  pickup_address:    string;
  pickup_lat:        number;
  pickup_lng:        number;
  dropoff_address:   string;
  dropoff_lat:       number;
  dropoff_lng:       number;
  item_description:  string;
  status:            DeliveryStatus;
  driver_id:         string | null;
  timeout_seconds:   number;
  estimated_minutes: number;
  created_at:        string;
  accepted_at:       string | null;
  completed_at:      string | null;
  cancelled_at:      string | null;
  timed_out_at:      string | null;
}

export interface ScoreBreakdown {
  overall:         number | null;
  acceptance:      number;
  onTime:          number;
  completion:      number;
  totalDeliveries: number;
}
