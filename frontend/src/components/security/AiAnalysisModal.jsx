import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, ConfigProvider, theme, Skeleton, Button, Tag, Typography,
  Space, Row, Col, Alert,
} from 'antd';
import {
  RobotOutlined, ReloadOutlined, WarningOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import client from '../../api/client';
import StatusBadge from './StatusBadge';

const { Text, Paragraph } = Typography;

// Severity banner colours — brief section 12.
const SEVERITY_META = {
  INFO:     { bg: '#595959', label: 'INFO' },
  LOW:      { bg: '#1890ff', label: 'FAIBLE' },
  MEDIUM:   { bg: '#faad14', label: 'MOYENNE' },
  HIGH:     { bg: '#fa8c16', label: 'ÉLEVÉE' },
  CRITICAL: { bg: '#cf1322', label: 'CRITIQUE' },
};
const severityMeta = (lvl) => SEVERITY_META[(lvl || 'MEDIUM').toUpperCase()] || SEVERITY_META.MEDIUM;

const LIKELIHOOD_META = {
  LOW:    { color: 'green',  label: 'FAIBLE' },
  MEDIUM: { color: 'orange', label: 'MOYENNE' },
  HIGH:   { color: 'red',    label: 'ÉLEVÉE' },
};
const likMeta = (l) => LIKELIHOOD_META[(l || 'LOW').toUpperCase()] || LIKELIHOOD_META.LOW;

const DISCLAIMER = "Aide à la décision générée par IA — à vérifier avant toute action.";

// --- small presentational helpers ---------------------------------------
const Section = ({ title, children }) => (
  <div>
    <Text strong style={{ color: '#fa8c16', fontSize: 12, letterSpacing: 0.6 }}>
      {title.toUpperCase()}
    </Text>
    <div style={{ marginTop: 6 }}>{children}</div>
  </div>
);

const BulletList = ({ items }) => (
  <ul style={{ margin: 0, paddingLeft: 20 }}>
    {(items || []).map((it, i) => <li key={i} style={{ marginBottom: 4 }}>{it}</li>)}
  </ul>
);

const ThreatCard = ({ title, data }) => {
  const m = likMeta(data?.likelihood);
  return (
    <div style={{ border: '1px solid #434343', borderRadius: 8, padding: 12, height: '100%' }}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Text strong>{title}</Text>
        <Tag color={m.color} style={{ fontWeight: 700, margin: 0 }}>{m.label}</Tag>
        <Text type="secondary" style={{ fontSize: 12.5 }}>{data?.reasoning || '—'}</Text>
      </Space>
    </div>
  );
};

const AlgorithmicFacts = ({ log }) => {
  const score = log?.anomaly?.score;
  return (
    <div style={{ border: '1px solid #434343', borderRadius: 8, padding: '10px 14px', background: '#1f1f1f' }}>
      <Space wrap size={8}>
        <Text type="secondary">Détecté par l'algorithme :</Text>
        <StatusBadge status={log?.anomaly?.status} />
        <Text>score : <Text strong>{score != null ? Number(score).toFixed(4) : '—'}</Text></Text>
      </Space>
      <div style={{ marginTop: 4 }}>
        <Text type="secondary" style={{ fontSize: 11.5 }}>
          Statut et score calculés par le moteur algorithmique (autoencodeur + règles).
          L'IA n'a pas pris cette décision — elle ne fait que l'expliquer.
        </Text>
      </div>
    </div>
  );
};

// --- main component ------------------------------------------------------
const AiAnalysisModal = ({ open, log, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState(null);    // section 6.2 payload
  const [error, setError] = useState(null);  // string

  const logId = log?.id;

  const runAnalysis = useCallback(async (forceRefresh) => {
    if (!logId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.post(
        `/api/security/logs/${logId}/analyze`,
        { force_refresh: !!forceRefresh },
      );
      const body = res.data || {};
      if (body.error) {
        setError(body.error.message || 'Analyse impossible.');
        setResp(null);
      } else {
        setResp(body.data);
      }
    } catch (e) {
      setError("L'analyse IA est indisponible (erreur réseau ou serveur).");
      setResp(null);
    } finally {
      setLoading(false);
    }
  }, [logId]);

  // Fetch when the modal opens for a log. Keyed by logId so the 15s table
  // refresh cannot mismatch the analysis to the wrong row.
  useEffect(() => {
    if (open && logId) {
      setResp(null);
      setError(null);
      runAnalysis(false);
    }
  }, [open, logId, runAnalysis]);

  const renderReport = () => {
    const a = resp.analysis || {};
    const sev = severityMeta(a.severity?.level);
    const model = (resp.model || '').toLowerCase();
    const isFallback = model.includes('fallback');
    const isMock = model === 'mock';
    const conf = likMeta(a.confidence);

    return (
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Severity banner */}
        <div style={{
          background: sev.bg, color: '#fff', padding: '14px 18px', borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <WarningOutlined style={{ fontSize: 20 }} />
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.5 }}>
            Sévérité : {sev.label}
          </span>
        </div>

        {/* Read-only algorithmic facts */}
        <AlgorithmicFacts log={log} />

        {/* Cache / fallback / mock indicators + re-analyze */}
        <Space wrap size={8}>
          {resp.cached && (
            <Tag icon={<DatabaseOutlined />} color="default">Résultat en cache</Tag>
          )}
          {isMock && <Tag color="purple">Mode démo (analyse simulée)</Tag>}
          <Button size="small" icon={<ReloadOutlined />} loading={loading}
            onClick={() => runAnalysis(true)}>
            Ré-analyser
          </Button>
        </Space>
        {isFallback && (
          <Alert type="warning" showIcon
            message="Analyse IA détaillée indisponible — rapport de repli affiché. Réessayez plus tard." />
        )}

        {/* Incident summary + why */}
        <Section title="Résumé de l'incident">
          <Text strong style={{ fontSize: 15 }}>{a.incident_summary}</Text>
        </Section>
        <Section title="Pourquoi c'est suspect">
          <Paragraph style={{ marginBottom: 0 }}>{a.why_suspicious}</Paragraph>
        </Section>

        {/* Risk + response lists */}
        <Section title="Risques de sécurité">
          <BulletList items={a.security_risks} />
        </Section>

        {/* Threat gauges */}
        <Row gutter={12}>
          <Col span={12}><ThreatCard title="Menace interne" data={a.insider_threat} /></Col>
          <Col span={12}><ThreatCard title="Compte compromis" data={a.compromised_account} /></Col>
        </Row>

        <Section title="Mesures d'atténuation recommandées">
          <BulletList items={a.recommended_mitigations} />
        </Section>
        <Section title="Réponse administrateur recommandée">
          <BulletList items={a.recommended_admin_response} />
        </Section>

        {/* Severity explanation + confidence + MITRE */}
        <Section title="Évaluation de la sévérité">
          <Paragraph style={{ marginBottom: 0 }}>{a.severity?.explanation}</Paragraph>
        </Section>
        <Space wrap>
          <Text type="secondary">Confiance de l'analyse :</Text>
          <Tag color={conf.color} style={{ fontWeight: 700 }}>{conf.label}</Tag>
        </Space>
        {Array.isArray(a.mitre_attack_refs) && a.mitre_attack_refs.length > 0 && (
          <Section title="Références MITRE ATT&CK">
            <Space wrap>
              {a.mitre_attack_refs.map((r) => <Tag key={r} color="geekblue">{r}</Tag>)}
            </Space>
          </Section>
        )}

        {/* Always-visible disclaimer */}
        <Alert type="info" showIcon message={DISCLAIMER} />

        <Text type="secondary" style={{ fontSize: 11 }}>
          Modèle : {resp.model || '—'}
          {resp.generated_at ? ` · généré le ${new Date(resp.generated_at).toLocaleString('fr-FR')}` : ''}
        </Text>
      </Space>
    );
  };

  const renderError = () => (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert type="error" showIcon message="Analyse IA indisponible" description={error} />
      {/* The algorithmic facts still render even when the LLM is unreachable. */}
      <AlgorithmicFacts log={log} />
      <Button type="primary" icon={<ReloadOutlined />} loading={loading}
        onClick={() => runAnalysis(false)}>
        Réessayer
      </Button>
      <Alert type="info" showIcon message={DISCLAIMER} />
    </Space>
  );

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#fa8c16' } }}>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={760}
        maskClosable={!loading}
        title={
          <Space>
            <RobotOutlined style={{ color: '#fa8c16' }} />
            <span>Analyse IA Sécurité — Événement #{logId ?? '—'}</span>
          </Space>
        }
      >
        <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 }}>
          {loading && <Skeleton active paragraph={{ rows: 12 }} />}
          {!loading && error && renderError()}
          {!loading && !error && resp && renderReport()}
        </div>
      </Modal>
    </ConfigProvider>
  );
};

export default AiAnalysisModal;
