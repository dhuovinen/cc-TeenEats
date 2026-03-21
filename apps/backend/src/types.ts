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
  created_at: string;
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
  cancelled_at: string | null;
  timed_out_at: string | null;
}

export interface LocationEvent {
  id: string;
  driver_id: string;
  delivery_id: string;
  lat: number;
  lng: number;
  ts: string;
}

export interface DeliveryScore {
  id: string;
  driver_id: string;
  delivery_id: string;
  accepted: boolean;
  on_time: boolean | null;
  completed: boolean | null;
  created_at: string;
}

export interface Settings {
  request_timeout_seconds: number;
}

// Extend Express Request to carry authenticated driver
declare global {
  namespace Express {
    interface Request {
      driverId?: string;
      driverName?: string;
    }
  }
}
