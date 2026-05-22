import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Typography, Statistic, Table, Tag, Space, Avatar, List, Badge, Spin, message } from 'antd';
import { TeamOutlined, DollarOutlined, ClockCircleOutlined, RiseOutlined, ExperimentOutlined, UserOutlined } from '@ant-design/icons';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import client from '../api/client';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalConsultations: 0,
    waiting: 0,
    avgWaitTime: 0,
    revenue: 0,
    activeHospitalizations: 0,
    totalBedsCount: 0,
    todaysLabs: 0
  });
  const [serviceData, setServiceData] = useState([]);
  const [hourlyData, setHourlyData] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [onlineDoctors, setOnlineDoctors] = useState([]);

  const superParse = (data) => {
    if (!data) return [];
    try {
      let p = typeof data === 'string' ? JSON.parse(data) : data;
      if (typeof p === 'string') p = JSON.parse(p);
      return Array.isArray(p) ? p : [];
    } catch(e) { return []; }
  };

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const t = new Date().getTime();
        const [apptsRes, logsRes, docsRes, settingsRes, hospRes, labRes] = await Promise.all([
          client.get(`/appointments/all?t=${t}`).catch(() => ({ data: [] })),
          client.get(`/audit-logs?t=${t}`).catch(() => ({ data: [] })),
          client.get(`/doctors?t=${t}`).catch(() => ({ data: [] })),
          client.get(`/settings?t=${t}`).catch(() => ({ data: {} })),
          client.get(`/hospitalizations/active?t=${t}`).catch(() => ({ data: [] })),
          client.get(`/lab/orders/today?t=${t}`).catch(() => client.get(`/lab/orders/pending?t=${t}`).catch(() => ({ data: [] })))
        ]);

        const rawPrices = superParse(settingsRes.data?.prices);
        const priceCatalogue = {};
        rawPrices.forEach(item => {
          if (item.name) priceCatalogue[item.name] = Number(item.amount) || 0;
        });
        
        const allRooms = superParse(settingsRes.data?.rooms);
        let totalBedsCount = 0;
        allRooms.forEach(room => {
          if (!room.type?.includes("Cabinet") && !room.type?.includes("Infirmerie") && !room.type?.includes("Soins")) {
            totalBedsCount += (parseInt(room.capacity || room.beds) || 0);
          }
        });

        const today = dayjs().format('YYYY-MM-DD');
        const todaysAppts = (apptsRes.data || []).filter(a => a.scheduled_time && a.scheduled_time.startsWith(today));

        const totalConsultations = todaysAppts.length;
        const waiting = todaysAppts.filter(a => a.status === 'Waiting' || a.status === 'In Progress').length;
        const activeHospitalizations = (hospRes.data || []).length;
        const todaysLabs = (labRes.data || []).length;
        
        const paidAppts = todaysAppts.filter(a => a.payment_status === 'Paid');
        let realRevenue = 0;
        
        paidAppts.forEach(appt => {
          if (priceCatalogue[appt.service]) realRevenue += priceCatalogue[appt.service];
          else if (priceCatalogue["Consultation Générale"]) realRevenue += priceCatalogue["Consultation Générale"];
          else realRevenue += 1500;
        });

        (logsRes.data || []).forEach(log => {
          if (dayjs(log.timestamp).format('YYYY-MM-DD') === today) {
            if (log.action === 'CUSTOM_PAYMENT_RECEIVED' || log.action === 'LAB_PAYMENT_RECEIVED') {
              const match = log.details.match(/Amount:\s*(\d+)/);
              if (match) realRevenue += parseInt(match[1], 10);
            }
          }
        });
        
        const activeDocsCount = (docsRes.data || []).filter(d => d.is_online).length || 1;
        const avgWaitTime = Math.round((waiting * 12) / activeDocsCount);

        setMetrics({ totalConsultations, waiting, avgWaitTime, revenue: realRevenue, activeHospitalizations, totalBedsCount, todaysLabs });
        setOnlineDoctors((docsRes.data || []).filter(d => d.is_online));

        const serviceCounts = {};
        if (hospRes.data && hospRes.data.length > 0) {
          hospRes.data.forEach(h => {
             const poleName = h.department || 'General Department';
             serviceCounts[poleName] = (serviceCounts[poleName] || 0) + 1;
          });
        }
        if (labRes.data && labRes.data.length > 0) {
          serviceCounts["Lab Tests"] = labRes.data.length;
        }
        if (todaysAppts.length > 0) {
          todaysAppts.forEach(a => {
             const svc = a.service || 'Standard Consultation';
             serviceCounts[svc] = (serviceCounts[svc] || 0) + 1;
          });
        }

        const pieData = Object.keys(serviceCounts).map(key => ({
          name: key,
          value: serviceCounts[key]
        }));
        setServiceData(pieData);

        const hourCounts = {};
        for(let i = 0; i <= 23; i++) { hourCounts[`${i}h`] = 0; }
        
        todaysAppts.forEach(appt => {
          if(appt.scheduled_time) {
            const hour = dayjs(appt.scheduled_time).format('H');
            hourCounts[`${hour}h`] += 1;
          }
        });

        (labRes.data || []).forEach(lab => {
          if(lab.ordered_at) {
            const hr = dayjs(lab.ordered_at).format('H');
            hourCounts[`${hr}h`] += 1;
          }
        });

        const areaData = Object.keys(hourCounts).map(key => ({
          heure: key,
          patients: hourCounts[key]
        }));
        setHourlyData(areaData);

        const importantLogs = (logsRes.data || []).filter(l => !l.action.includes('SETTINGS')).slice(0, 5);
        setRecentLogs(importantLogs);

      } catch (error) {
        console.error("Dashboard Sync Error", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 10000); 
    return () => clearInterval(interval);
  }, []);

  const logColumns = [
    { title: 'Time', dataIndex: 'timestamp', render: t => dayjs(t).format('HH:mm'), width: 80 },
    { title: 'User', dataIndex: 'user', render: u => <Text strong>{u || 'System'}</Text>, width: 120 },
    { title: 'Event', dataIndex: 'action', render: (a, record) => (
      <Tag color={record.action.includes('VIOLATION') ? 'red' : 'blue'} style={{ borderRadius: '4px' }}>
        {a.replace(/_/g, ' ')}
      </Tag>
    )},
  ];

  const glassCardStyle = {
    borderRadius: '16px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.03)',
    border: 'none',
    height: '100%'
  };

  if (loading) return <div style={{ textAlign: 'center', marginTop: 100 }}><Spin size="large" /></div>;

  return (
    <div style={{ padding: '30px', backgroundColor: '#F3F4F6', minHeight: '100vh', animation: 'fadeIn 0.6s' }}>
      
      <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#111827', fontWeight: 700 }}>
            <RiseOutlined style={{ color: '#4F46E5', marginRight: '10px' }} />
            Clinic Overview
          </Title>
          <Text style={{ color: '#6B7280', fontSize: '15px' }}>Real-time analysis of today's performance.</Text>
        </div>
        <Tag color="cyan" style={{ padding: '8px 16px', borderRadius: '20px', fontSize: '14px', fontWeight: 600 }}>
          Live • {dayjs().format('DD MMM YYYY')}
        </Tag>
      </div>

      <Row gutter={[24, 24]} style={{ marginBottom: '24px' }}>
        <Col xs={24} sm={12} lg={8} xl={6}>
          <Card style={{ ...glassCardStyle, background: 'linear-gradient(135deg, #ffffff 0%, #f0f7ff 100%)' }}>
            <Statistic 
              title={<Text style={{ color: '#6B7280', fontWeight: 600 }}>Consultations Today</Text>}
              value={metrics.totalConsultations} 
              prefix={<TeamOutlined style={{ color: '#3B82F6', marginRight: '8px' }} />} 
              valueStyle={{ color: '#111827', fontSize: '28px', fontWeight: 800 }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8} xl={6}>
          <Card style={{ ...glassCardStyle, background: 'linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%)' }}>
            <Statistic 
              title={<Text style={{ color: '#6B7280', fontWeight: 600 }}>Hospitalized / Total Beds</Text>}
              value={`${metrics.activeHospitalizations} / ${metrics.totalBedsCount}`} 
              prefix={<UserOutlined style={{ color: '#EF4444', marginRight: '8px' }} />} 
              valueStyle={{ color: '#111827', fontSize: '28px', fontWeight: 800 }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8} xl={6}>
          <Card style={{ ...glassCardStyle, background: 'linear-gradient(135deg, #ffffff 0%, #fdf4ff 100%)' }}>
            <Statistic 
              title={<Text style={{ color: '#6B7280', fontWeight: 600 }}>Lab Tests (Today)</Text>}
              value={metrics.todaysLabs} 
              prefix={<ExperimentOutlined style={{ color: '#8B5CF6', marginRight: '8px' }} />} 
              valueStyle={{ color: '#111827', fontSize: '28px', fontWeight: 800 }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8} xl={6}>
          <Card style={{ ...glassCardStyle, background: 'linear-gradient(135deg, #ffffff 0%, #fffbf0 100%)' }}>
            <Statistic 
              title={<Text style={{ color: '#6B7280', fontWeight: 600 }}>Estimated Wait (Consult.)</Text>}
              value={metrics.avgWaitTime} 
              suffix={<Text style={{ fontSize: '14px', color: '#F59E0B', marginLeft: '5px' }}>min</Text>}
              prefix={<ClockCircleOutlined style={{ color: '#F59E0B', marginRight: '8px' }} />} 
              valueStyle={{ color: '#111827', fontSize: '28px', fontWeight: 800 }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={12} xl={12}>
          <Card style={{ ...glassCardStyle, background: 'linear-gradient(135deg, #ffffff 0%, #fef2f2 100%)' }}>
            <Statistic 
              title={<Text style={{ color: '#6B7280', fontWeight: 600 }}>In Waiting Room (Consult.)</Text>}
              value={metrics.waiting} 
              prefix={<TeamOutlined style={{ color: '#EF4444', marginRight: '8px' }} />} 
              valueStyle={{ color: '#111827', fontSize: '32px', fontWeight: 800 }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={12} xl={12}>
          <Card style={{ ...glassCardStyle, background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)' }}>
            <Statistic 
              title={<Text style={{ color: '#D1FAE5', fontWeight: 600 }}>Total Revenue</Text>}
              value={metrics.revenue} 
              suffix={<Text style={{ fontSize: '14px', color: '#D1FAE5', marginLeft: '5px' }}>DZD</Text>}
              prefix={<DollarOutlined style={{ color: '#ffffff', marginRight: '8px' }} />} 
              valueStyle={{ color: '#ffffff', fontSize: '32px', fontWeight: 800 }} 
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={24} style={{ marginBottom: '24px' }}>
        <Col span={16}>
          <Card title={<Text strong style={{ fontSize: '18px' }}>Patient Flow (Admissions per hour)</Text>} style={glassCardStyle} bodyStyle={{ padding: '24px 24px 0 24px', height: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData} margin={{ top: 10, right: 30, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPatients" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="heure" axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} dy={10} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }} />
                <Area type="monotone" dataKey="patients" stroke="#4F46E5" strokeWidth={4} fillOpacity={1} fill="url(#colorPatients)" animationDuration={1500} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        
        <Col span={8}>
          <Card title={<Text strong style={{ fontSize: '18px' }}>Distribution by Department</Text>} style={glassCardStyle} bodyStyle={{ height: '350px' }}>
            {serviceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={serviceData} cx="50%" cy="45%" innerRadius={80} outerRadius={110} paddingAngle={8} dataKey="value" animationDuration={1500} stroke="none">
                    {serviceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', paddingTop: '100px', color: '#9CA3AF' }}>No data yet</div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={24}>
        <Col span={8}>
          <Card title={<Text strong style={{ fontSize: '18px' }}>Doctors on Duty</Text>} style={glassCardStyle}>
            <List
              itemLayout="horizontal"
              dataSource={onlineDoctors}
              locale={{ emptyText: "No doctors online." }}
              renderItem={doc => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar style={{ backgroundColor: '#10B981' }} icon={<UserOutlined />} />}
                    title={<Text strong>Dr. {doc.username}</Text>}
                    description={<Text type="secondary">{doc.specialty || 'General Practitioner'}</Text>}
                  />
                  <div style={{ textAlign: 'right' }}>
                    <Badge status="success" text={<Text style={{ fontSize: '12px', color: '#10B981' }}>{doc.room_number}</Text>} />
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col span={16}>
          <Card title={<Text strong style={{ fontSize: '18px' }}>Latest System Activity</Text>} style={glassCardStyle}>
            <Table 
              dataSource={recentLogs} 
              columns={logColumns} 
              rowKey="id" 
              pagination={false} 
              size="middle"
              loading={loading}
              rowClassName={(record) => record.action.includes('VIOLATION') ? 'table-row-danger' : ''}
            />
          </Card>
        </Col>
      </Row>

    </div>
  );
};

export default AdminDashboard;