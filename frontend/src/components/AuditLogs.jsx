import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Typography, Space, Button, Input, DatePicker, Row, Col, Statistic, message } from 'antd';
import {
  SafetyCertificateOutlined,
  SyncOutlined,
  SearchOutlined,
  AlertOutlined,
  UnlockOutlined,
  EyeOutlined,
  RobotOutlined
} from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';
import StatusBadge, { normalizeStatus } from './security/StatusBadge';
import AiAnalysisButton from './security/AiAnalysisButton';
import AiAnalysisModal from './security/AiAnalysisModal';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const PAGE_SIZE_DEFAULT = 15;

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

const AuditLog = () => {
  // Server-paginated data — the API is the single source of truth for
  // filtering, so there is NO client-side search/date filtering here.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');          // debounced -> server
  const [dateRange, setDateRange] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);

  const [summary, setSummary] = useState({
    total_events: 0, security_violations: 0, ai_anomalies: 0, user_connections: 0,
  });

  // AI analysis modal — keyed by the captured log record so the 15s table
  // refresh cannot mismatch the analysis to the wrong row.
  const [analysisLog, setAnalysisLog] = useState(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);

  // Debounce the search box, then push it to the server query.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.from = dateRange[0].format('YYYY-MM-DD');
        params.to = dateRange[1].format('YYYY-MM-DD');
      }
      const res = await client.get('/api/security/logs', { params });
      const body = res.data || {};
      if (body.error) {
        message.error(`Logs error: ${body.error.message}`);
        setItems([]);
        setTotal(0);
      } else if (body.data) {
        setItems(body.data.items || []);
        setTotal(body.data.page ? body.data.page.total : 0);
      }
    } catch (e) {
      console.error('Error loading logs:', e);
      message.error('Unable to load security logs.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, dateRange]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await client.get('/api/security/logs/summary');
      const body = res.data || {};
      if (body.data) setSummary(body.data);
    } catch (e) {
      console.error('KPI summary error:', e);
    }
  }, []);

  // Refetch whenever a filter or the page changes.
  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // 15s live polling — current page + KPI counters.
  useEffect(() => {
    const interval = setInterval(() => { fetchLogs(); fetchSummary(); }, 15000);
    return () => clearInterval(interval);
  }, [fetchLogs, fetchSummary]);

  const handleRefresh = () => { fetchLogs(); fetchSummary(); };

  // AntD Table -> server-side pagination + status filter.
  const handleTableChange = (pagination, filters) => {
    if (pagination.current !== page) setPage(pagination.current);
    if (pagination.pageSize !== pageSize) {
      setPageSize(pagination.pageSize);
      setPage(1);
    }
    const sv = (filters && filters.severity && filters.severity[0]) || null;
    if (sv !== statusFilter) {
      setStatusFilter(sv);
      setPage(1);
    }
  };

  const columns = [
    {
      title: 'Date & Time',
      dataIndex: 'timestamp',
      key: 'time',
      render: (t) => <Text strong>{t ? dayjs(t).format('DD/MM/YYYY HH:mm:ss') : '—'}</Text>,
      width: 170,
    },
    {
      title: 'Operator',
      dataIndex: 'operator',
      key: 'user',
      render: (op) => (
        <Space direction="vertical" size={0}>
          <Tag color="default" style={{ fontWeight: 600, fontSize: '13px' }}>👤 {op?.username || 'System'}</Tag>
          {op?.role && <Text type="secondary" style={{ fontSize: 11 }}>{op.role}</Text>}
        </Space>
      ),
      width: 170,
    },
    {
      title: 'Action Type',
      dataIndex: 'action_type',
      key: 'action',
      render: (act) => (
        <Tag color={getActionColor(act)} style={{ fontWeight: 'bold', padding: '4px 10px', borderRadius: '4px' }}>
          {act || 'UNKNOWN_ACTION'}
        </Tag>
      ),
      width: 240,
    },
    {
      title: 'Event Details',
      dataIndex: 'event_details',
      key: 'details',
      render: (text) => {
        if (!text) return '';
        if (text.includes('Hash:')) {
          return (
            <Space>
              <UnlockOutlined style={{ color: '#52c41a' }} />
              <Text>{text}</Text>
            </Space>
          );
        }
        return text;
      },
    },
    {
      title: 'AI Security',
      dataIndex: 'anomaly',
      key: 'severity',
      width: 170,
      filters: [
        { text: 'Normal', value: 'NORMAL' },
        { text: 'Suspicious', value: 'SUSPICIOUS' },
        { text: 'Critical', value: 'CRITICAL' },
      ],
      filterMultiple: false,
      filteredValue: statusFilter ? [statusFilter] : null,
      render: (anomaly) => (
        <Space direction="vertical" size={0}>
          <StatusBadge status={anomaly?.status} />
          {anomaly && anomaly.score != null && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              score: {Number(anomaly.score).toFixed(4)}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 190,
      render: (_, record) => (
        <AiAnalysisButton
          record={record}
          onClick={(r) => { setAnalysisLog(r); setAnalysisOpen(true); }}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: '24px', background: '#f0f2f5', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>

      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#141414' }}>
            <SafetyCertificateOutlined style={{ color: '#1890ff', marginRight: 12 }} />
            Control & Audit Center
          </Title>
          <Text type="secondary" style={{ fontSize: 15 }}>Real-time monitoring of all actions across the hospital information system.</Text>
        </div>
        <Button type="primary" icon={<SyncOutlined />} onClick={handleRefresh} loading={loading} size="large" style={{ borderRadius: 8 }}>
          Refresh logs
        </Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #1890ff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>Total Events (Today)</Text>}
              value={summary.total_events}
              prefix={<EyeOutlined style={{ color: '#1890ff' }} />}
              valueStyle={{ fontWeight: 800, color: '#141414' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #ff4d4f', background: summary.security_violations > 0 ? '#fff1f0' : '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>Security Violations (Today)</Text>}
              value={summary.security_violations}
              prefix={<AlertOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ fontWeight: 800, color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #fa8c16', background: summary.ai_anomalies > 0 ? '#fff7e6' : '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>AI Anomalies (Today)</Text>}
              value={summary.ai_anomalies}
              prefix={<RobotOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{ fontWeight: 800, color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, borderLeft: '5px solid #52c41a', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic
              title={<Text strong style={{ color: '#8c8c8c' }}>User Logins (Today)</Text>}
              value={summary.user_connections}
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
              placeholder="Search by operator, action or detail..."
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              size="large"
              allowClear
              style={{ borderRadius: 8 }}
            />
          </Col>
          <Col span={10}>
            <RangePicker
              style={{ width: '100%', borderRadius: 8 }}
              size="large"
              onChange={(dates) => { setDateRange(dates); setPage(1); }}
              placeholder={['Start date', 'End date']}
            />
          </Col>
        </Row>
      </Card>

      <Card style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} bodyStyle={{ padding: 0 }}>
        <Table
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          size="middle"
          onChange={handleTableChange}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} events`
          }}
          rowClassName={(record) => {
            const s = normalizeStatus(record.anomaly?.status);
            if (s === 'CRITICAL') return 'ai-critical-row';
            if (s === 'SUSPICIOUS') return 'ai-suspicious-row';
            return '';
          }}
        />
        <style>{`
          .ai-suspicious-row td {
            background-color: #fff7e6 !important;
            border-left: 4px solid #fa8c16 !important;
          }
          .ai-suspicious-row:hover td { background-color: #ffe7ba !important; }
          .ai-critical-row td {
            background-color: #fff1f0 !important;
            border-left: 4px solid #ff4d4f !important;
          }
          .ai-critical-row:hover td { background-color: #ffccc7 !important; }
          .ant-table-thead > tr > th { background: #fafafa; font-weight: 600; }
        `}</style>
      </Card>

      <AiAnalysisModal
        open={analysisOpen}
        log={analysisLog}
        onClose={() => setAnalysisOpen(false)}
      />
    </div>
  );
};

export default AuditLog;
