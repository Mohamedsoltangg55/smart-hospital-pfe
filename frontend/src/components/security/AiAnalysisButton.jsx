import React from 'react';
import { Button } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { isFlagged } from './StatusBadge';

/**
 * "Analyse IA Sécurité" action button.
 * Renders ONLY on rows the algorithmic layer flagged (SUSPICIOUS / CRITICAL);
 * on NORMAL rows it renders nothing — a NORMAL log cannot be AI-analyzed.
 */
const AiAnalysisButton = ({ record, onClick }) => {
  if (!isFlagged(record)) return null;

  return (
    <Button
      size="small"
      icon={<SafetyCertificateOutlined />}
      onClick={() => onClick(record)}
      style={{ fontWeight: 600, borderColor: '#fa8c16', color: '#d46b08' }}
    >
      Analyse IA Sécurité
    </Button>
  );
};

export default AiAnalysisButton;
