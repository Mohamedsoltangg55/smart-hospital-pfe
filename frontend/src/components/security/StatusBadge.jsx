import React from 'react';
import { Tag } from 'antd';
import { CheckCircleOutlined, WarningOutlined, FireOutlined } from '@ant-design/icons';

// Presentation metadata for the 3-tier algorithmic status. French labels to
// match the existing UI ("Centre de Contrôle & Audit").
export const STATUS_META = {
  NORMAL:     { color: 'green',  label: 'Normal',   icon: <CheckCircleOutlined /> },
  SUSPICIOUS: { color: 'orange', label: 'Suspect',  icon: <WarningOutlined /> },
  CRITICAL:   { color: 'red',    label: 'Critique', icon: <FireOutlined /> },
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
// "AI Security Analysis" button visibility.
export const isFlagged = (record) => {
  const s = normalizeStatus(record?.severity);
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
