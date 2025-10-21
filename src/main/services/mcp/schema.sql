CREATE TABLE IF NOT EXISTS mcp_services (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  endpoint TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  capabilities JSON,
  actions JSON,
  version TEXT,
  trusted BOOLEAN DEFAULT FALSE,
  trust_level TEXT DEFAULT 'ask_always',
  allowed_actions JSON,
  rate_limit INTEGER DEFAULT 100,
  health_status TEXT DEFAULT 'unknown',
  last_health_check TIMESTAMP,
  consecutive_failures INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT DEFAULT 'system',
  total_requests INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  avg_latency_ms INTEGER DEFAULT 0,
  last_request_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_permissions (
  id TEXT PRIMARY KEY,
  from_service TEXT NOT NULL,
  to_service TEXT NOT NULL,
  action TEXT NOT NULL,
  allowed BOOLEAN DEFAULT FALSE,
  requires_user_confirmation BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP,
  use_count INTEGER DEFAULT 0,
  UNIQUE(from_service, to_service, action)
);

CREATE TABLE IF NOT EXISTS service_call_audit (
  id TEXT PRIMARY KEY,
  from_service TEXT NOT NULL,
  to_service TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSON,
  user_approved BOOLEAN DEFAULT FALSE,
  success BOOLEAN,
  error_message TEXT,
  duration_ms INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  trace_id TEXT,
  session_id TEXT
);

CREATE TABLE IF NOT EXISTS service_health_history (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_services_name ON mcp_services(name);
CREATE INDEX IF NOT EXISTS idx_mcp_services_enabled ON mcp_services(enabled);
CREATE INDEX IF NOT EXISTS idx_mcp_services_trusted ON mcp_services(trusted);
CREATE INDEX IF NOT EXISTS idx_service_permissions_from ON service_permissions(from_service);
CREATE INDEX IF NOT EXISTS idx_service_permissions_to ON service_permissions(to_service);
CREATE INDEX IF NOT EXISTS idx_service_call_audit_from ON service_call_audit(from_service);
CREATE INDEX IF NOT EXISTS idx_service_call_audit_to ON service_call_audit(to_service);
CREATE INDEX IF NOT EXISTS idx_service_call_audit_timestamp ON service_call_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_service_health_service ON service_health_history(service_name);
CREATE INDEX IF NOT EXISTS idx_service_health_checked ON service_health_history(checked_at);
