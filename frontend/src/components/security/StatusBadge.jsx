import React from 'react';
import { Tag } from 'antd';
import { CheckCircleOutlined, WarningOutlined, FireOutlined } from '@ant-design/icons';

// Presentation metadata for the 3-tier algorithmic status.
export const STATUS_META = {
  NORMAL:     { color: 'green',  label: 'Normal',     icon: <CheckCircleOutlined /> },
  SUSPICIOUS: { color: 'orange', label: 'Suspicious', icon: <WarningOutlined /> },
  CRITICAL:   { color: 'red',    label: 'Critical',   icon: <FireOutlined /> },
};

// Map any stored value (incl. legacy "SUSPICIOUS_UNKNOWN_PATTERN") to a tier.
export const normalizeStatus = (value) => {
  const s = (value || 'NORMAL').toUpperCase();
  if (s === 'CRITICAL') return 'CRITICAL';
  if (s === 'SUSPICIOUS' || s === 'SUSPICIOUS_UNKNOWN_PATTERN') return 'SUSPICIOUS';
  return 'NORMAL';
};

// A row is "flagged" (anomalous) when its status is SUSPICIOUS or CRITICAL.
// Single source of truth for the badge, the row highlight and — later — the
// "AI Security Analysis" button visibility. Accepts both the API DTO shape
// (record.anomaly.status) and the legacy flat shape (record.severity).
export const isFlagged = (record) => {
  const raw = record?.anomaly?.status ?? record?.severity;
  const s = normalizeStatus(raw);
  return s === 'SUSPICIOUS' || s === 'CRITICAL';
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[normalizeStatus(status)];
  return (
    <Tag color={meta.color} icon={meta.icon} style={{ fontWeight: 'bold' }}>
      {meta.label}
    </Tag>
  );
};

export default StatusBadge;
