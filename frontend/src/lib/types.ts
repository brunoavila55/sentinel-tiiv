export type OrganizationRole = "owner" | "admin" | "operator" | "viewer";
export type UserStatus = "active" | "disabled";
export type OrganizationStatus = "active" | "disabled";

export interface UserOut {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  created_at: string;
}

export interface MembershipOut {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: OrganizationRole;
}

export interface MeResponse {
  user: UserOut;
  memberships: MembershipOut[];
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: UserOut;
}

export interface OrganizationOut {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: OrganizationStatus;
  created_at: string;
  logo_light_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
}

export interface MemberOut {
  user_id: string;
  name: string;
  email: string;
  role: OrganizationRole;
  status: UserStatus;
  member_since: string;
}

export interface InviteOut {
  id: string;
  email: string;
  role: OrganizationRole;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  invite_url: string | null;
}

export interface InvitePreviewOut {
  organization_name: string;
  email: string;
  role: OrganizationRole;
  expires_at: string;
  account_exists: boolean;
}

export interface SiteOut {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  asset_count: number;
  created_at: string;
  updated_at: string;
}

export type AssetStatus = "unknown" | "up" | "warning" | "down";

export interface AssetOut {
  id: string;
  name: string;
  hostname: string | null;
  ip_address: string | null;
  description: string | null;
  backup_notes: string | null;
  site_id: string;
  site_name: string;
  parent_asset_id: string | null;
  enabled: boolean;
  status: AssetStatus;
  last_rtt_ms: number | null;
  packet_loss: number | null;
  last_check_at: string | null;
  status_since: string | null;
  checks_count: number;
  photos_count: number;
  created_at: string;
  updated_at: string;
}

export interface AssetListResponse {
  items: AssetOut[];
  total: number;
  limit: number;
  offset: number;
}

export const STATUS_LABELS: Record<AssetStatus, string> = {
  unknown: "Desconhecido",
  up: "Online",
  warning: "Alerta",
  down: "Offline",
};

export interface AssetPhotoOut {
  id: string;
  asset_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  caption: string | null;
  position: number;
  category: "general" | "backup";
  is_primary: boolean;
  url: string;
  thumbnail_url: string;
  created_at: string;
}

export interface CheckResultOut {
  id: string;
  check_id: string;
  status: AssetStatus;
  latency_ms: number | null;
  packet_loss: number | null;
  message: string | null;
  checked_at: string;
}

export interface ProblemOut {
  asset_id: string;
  asset_name: string;
  site_name: string;
  ip_or_hostname: string;
  status: AssetStatus;
  status_since: string | null;
  last_rtt_ms: number | null;
  last_check_at: string | null;
  message: string | null;
}

export interface TopologyNodeOut {
  id: string;
  name: string;
  status: AssetStatus;
  ip: string | null;
  last_rtt_ms: number | null;
  site: string;
  has_photo: boolean;
}

export interface TopologyLinkOut {
  id: string;
  source_asset_id: string;
  target_asset_id: string;
  link_type: string;
  created_at: string;
}

export interface TopologyResponse {
  nodes: TopologyNodeOut[];
  edges: TopologyLinkOut[];
}

export interface CheckOut {
  id: string;
  asset_id: string;
  type: string;
  enabled: boolean;
  interval_seconds: number;
  timeout_seconds: number;
  packets: number;
  next_check_at: string | null;
  last_check_at: string | null;
  consecutive_successes: number;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operador",
  viewer: "Visualizador",
};
