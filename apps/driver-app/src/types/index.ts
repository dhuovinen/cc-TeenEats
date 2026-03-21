export type DriverStatus = 'offline' | 'online' | 'busy';
export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'active'
  | 'completed'
  | 'timed_out'
  | 'cancelled';

export interface Driver {
  id: string;
  name: string;
  email: string;
  status: DriverStatus;
  safety_score: number | null;
}

export interface Delivery {
  id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  item_description: string;
  status: DeliveryStatus;
  driver_id: string | null;
  timeout_seconds: number;
  estimated_minutes: number;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export interface ScoreBreakdown {
  overall: number | null;
  acceptance: number | null;
  onTime: number | null;
  completion: number | null;
  totalDeliveries: number;
}
