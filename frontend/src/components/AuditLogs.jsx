import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Typography, Space, Button, Input, DatePicker, Row, Col, Statistic } from 'antd';
import {
  SafetyCertificateOutlined,
  SyncOutlined,
  SearchOutlined,
  AlertOutlined,
  UnlockOutlined,
  EyeOutlined,
  WarningOutlined,
  RobotOutlined
} from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';

dayjs.extend(isBetween);

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const getActionColor = (action) => {
  if (!action) return 'default';
  const act = action.toUpperCase();

  if (act.includes('SECURITY_VIOLATION') || act.includes('DELETED')) return 'red';
  if (act.includes('PAYMENT_RECEIVED') || act.includes('LOGIN') || act.includes('STARTUP')) return 'success';
  if (act.includes('LAB') || act.includes('CONSULTATION') || act.includes('TRIAGE') || act.includes('ADMITTED') || act.includes('DISCHARGED')) return 'purple';
  if (act.includes('FOLDER_ACCESSED') || act.includes('REGISTERED') || act.includes('CREATED')) return 'blue';
  if (act.includes('STATUS') || act.includes('UPDATED')) return 'warning';

  return 'default';
};

const isSuspicious = (record) => {
  const s = (record?.severity || '').toUpperCase();
  return s === 'SUSPICIOUS' || s === 'SUSPICIOUS_UNKNOWN_PATTERN';
};

const renderSeverity = (severity, record) => {
  const s = (severity || 'NORMAL').toUpperCase();
  if (s === 'SUSPICIOUS') {
    return (
      <Tag color="red" icon={<WarningOutlined />} style={{ fontWeight: 'bold' }}>
        SUSPICIOUS
      </Tag>
    );
  }
  if (s === 'SUSPICIOUS_UNKNOWN_PATTERN') {
    return (
      <Tag color="volcano" icon={<WarningOutlined />} style={{ fontWeight: 'bold' }}>
        UNKNOWN PATTERN
      </Tag>
    );
  }
  return (
    <Tag color="green" icon={<RobotOutlined />} style={{ fontWeight: 500 }}>
      Normal
    </Tag>
  );
};

const AuditLog = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('/audit-logs');
      setLogs(res.data || []);
    } catch (error) {
      console.error("Erreur de chargement des logs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 15000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const filteredLogs = logs.filter(log => {
    const matchesText = 
      (log.user || 'Système').toLowerCase().includes(searchText.toLowerCase()) ||
      (log.action || '').toLowerCase().includes(searchText.toLowerCase()) ||
      (log.details || '').toLowerCase().includes(searchText.toLowerCase());

    let matchesDate = true;
    if (dateRange && dateRange[0] && dateRange[1]) {
      const logDate = dayjs(log.timestamp);
      matchesDate = logDate.isBetween(dateRange[0], dateRange[1], 'day', '[]');
    }

    return matchesText && matchesDate;
  });

  const todayLogs = logs.filter(l => dayjs(l.timestamp).isSame(dayjs(), 'day'));
  const securityAlerts = todayLogs.filter(l => (l.action || '').includes('SECURITY_VIOLATION')).length;
  const loginsToday = todayLogs.filter(l => (l.action || '').includes('USER_LOGIN')).length;
  const aiAnomaliesToday = todayLogs.filter(l => isSuspicious(l)).length;

  const columns = [
    { 
      title: 'Date & Heure', 
      dataIndex: 'timestamp', 
      key: 'time', 
      render: (t) => <Text strong>{dayjs(t).format('DD/MM/YYYY HH:mm:ss')}</Text>, 
      width: 170,
      sorter: (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
      defaultSortOrder: 'descend'
    },
    { 
      title: 'Opérateur', 
      dataIndex: 'user', 
      key: 'user', 
      render: (u) => <Tag color="default" style={{ fontWeight: 600, fontSize: '13px' }}>👤 {u || 'Système'}</Tag>, 
      width: 160 
    },
    { 
      title: 'Type d\'Action', 
      dataIndex: 'action', 
      key: 'action', 
      render: (act) => (
        <Tag color={getActionColor(act)} style={{ fontWeight: 'bold', padding: '4px 10px', borderRadius: '4px' }}>
          {act || 'UNKNOWN_ACTION'}
        </Tag>
      ), 
      width: 250 
    },
    {
      title: 'Détails de l\'événement',
      dataIndex: 'details',
      key: 'details',
      render: (text) => {
        if (!text) return '';
        if (text.includes("Hash:")) {
          return (
            <Space>
              <UnlockOutlined style={{ color: '#52c41a' }} />
              <Text>{text}</Text>
            </Space>
          );
        }
        return text;
      }
    },
    {
      title: 'IA Sécurité',
      dataIndex: 'severity',
      key: 'severity',
      width: 170,
      filters: [
        { text: 'Normal', value: 'NORMAL' },
        { text: 'Suspicious', value: 'SUSPICIOUS' },
        { text: 'Unknown Pattern', value: 'SUSPICIOUS_UNKNOWN_PATTERN' },
      ],
      onFilter: (value, record) => (record.severity || 'NORMAL').toUpperCase() === value,
      render: (severity, record) => (
        <Space direction="vertical" size={0}>
          {renderSeverity(severity, record)}
          {record.anomaly_score && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              score: {Number(record.anomaly_score).toFixed(4)}
            </Text>
          )}
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: '24px', background: '#f0f2f5', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>
      
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#141414' }}>
            <SafetyCertificateOutlined style={{ color: '#1890ff', marginRight: 12 }} /> 
            Centre de Contrôle & Audit
          </Title>
          <Text type="secondary" style={{ fontSize: 15 }}>Surveillance en temps réel de toutes les actions du système d'information hospitalier.</Text>
        </div>
        <Button type="primary" icon={<SyncOutlined />} onClick={fetchLogs} loading={loading} size="large" style={{ borderRadius: 8 }}>
          Rafraîchir les logs
        </Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #1890ff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>Total des événements (Aujourd'hui)</Text>}
              value={todayLogs.length}
              prefix={<EyeOutlined style={{ color: '#1890ff' }} />}
              valueStyle={{ fontWeight: 800, color: '#141414' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #ff4d4f', background: securityAlerts > 0 ? '#fff1f0' : '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>Violations de Sécurité (Aujourd'hui)</Text>}
              value={securityAlerts}
              prefix={<AlertOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ fontWeight: 800, color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #fa8c16', background: aiAnomaliesToday > 0 ? '#fff7e6' : '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>Anomalies IA (Aujourd'hui)</Text>}
              value={aiAnomaliesToday}
              prefix={<RobotOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{ fontWeight: 800, color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #52c41a', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>Connexions Utilisateurs (Aujourd'hui)</Text>}
              value={loginsToday}
              prefix={<UnlockOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ fontWeight: 800, color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} bodyStyle={{ padding: '16px 24px' }}>
        <Row gutter={16}>
          <Col span={14}>
            <Input 
              placeholder="Rechercher un opérateur, une action ou un détail..." 
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />} 
              value={searchText} 
              onChange={e => setSearchText(e.target.value)} 
              size="large" 
              allowClear
              style={{ borderRadius: 8 }}
            />
          </Col>
          <Col span={10}>
            <RangePicker 
              style={{ width: '100%', borderRadius: 8 }} 
              size="large" 
              onChange={(dates) => setDateRange(dates)}
              placeholder={['Date de début', 'Date de fin']}
            />
          </Col>
        </Row>
      </Card>

      <Card style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} bodyStyle={{ padding: 0 }}>
        <Table 
          columns={columns} 
          dataSource={filteredLogs} 
          rowKey="id" 
          loading={loading} 
          size="middle" 
          pagination={{ 
            pageSize: 15, 
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} sur ${total} événements`
          }} 
          rowClassName={(record) => {
            if (isSuspicious(record)) return 'ai-suspicious-row';
            if ((record.action || '').includes('SECURITY_VIOLATION')) return 'security-alert-row';
            return '';
          }}
        />
        <style>{`
          .security-alert-row td { background-color: #fff1f0 !important; }
          .ai-suspicious-row td {
            background-color: #fff1f0 !important;
            border-left: 4px solid #ff4d4f !important;
          }
          .ai-suspicious-row:hover td { background-color: #ffccc7 !important; }
          .ant-table-thead > tr > th { background: #fafafa; font-weight: 600; }
        `}</style>
      </Card>
    </div>
  );
};

export default AuditLog;