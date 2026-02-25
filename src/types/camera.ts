/**
 * Unified camera feed types for CCTV integration.
 * All external camera API responses are normalised to these shapes.
 */

export interface CameraFeed {
  id: string;
  name: string;
  source: CameraSource;
  country: string;        // ISO 3166-1 alpha-2 ("GB", "US", "AU")
  countryName: string;    // "United Kingdom"
  region: string;         // "London", "Austin, TX", "NSW"
  latitude: number;
  longitude: number;
  imageUrl: string;       // Current JPEG snapshot URL
  videoUrl?: string;      // Optional MP4/stream URL
  available: boolean;
  viewDirection?: string; // e.g. "East", "N-W"
  lastUpdated: string;    // ISO 8601
}

export type CameraSource = 'tfl' | 'austin' | 'tfnsw' | 'windy' | 'nycdot' | 'caltrans';

export interface CameraMeta {
  totalCameras: number;
  onlineCameras: number;
  sources: string[];
  countries: string[];
  lastUpdated: string;
}

export interface CameraApiResponse {
  cameras: CameraFeed[];
  meta: CameraMeta;
}

export interface CameraCountry {
  code: string;
  name: string;
  flag: string;
  count: number;
}
