import React, { useState, useEffect } from 'react';
import { Table, Card, Typography, Input, Space, Tag, Button, Row, Col, message, Drawer, Timeline, Empty, Divider, Tabs, Badge, Spin } from 'antd';
import { TeamOutlined, SearchOutlined, ReloadOutlined, IdcardOutlined, FolderOpenOutlined, ClockCircleOutlined, MedicineBoxOutlined, ExperimentOutlined, AppstoreOutlined } from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const PatientList = () => {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  
  // Drawer State for Admin Folder View
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [viewingPatient, setViewingPatient] = useState(null);
  
  // Data States for the Folder
  const [historyData, setHistoryData] = useState([]);
  const [labResults, setLabResults] = useState([]);
  const [hospitalizationData, setHospitalizationData] = useState([]);
  const [folderLoading, setFolderLoading] = useState(false);

  useEffect(() => {
    fetchPatients();
  }, []);

  const fetchPatients = async () => {
    setLoading(true);
    try {
      const res = await client.get(`/patients/?t=${new Date().getTime()}`);
      setPatients(res.data.sort((a, b) => b.id - a.id));
    } catch (error) {
      message.error("Unable to load the patient directory.");
    } finally {
      setLoading(false);
    }
  };

  const filteredPatients = patients.filter(p => {
    const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
    const searchLower = searchText.toLowerCase();
    const nssMatch = p.nss ? p.nss.toLowerCase().includes(searchLower) : false;
    return fullName.includes(searchLower) || nssMatch;
  });

  const openMedicalFolder = async (patient) => {
    setViewingPatient(patient);
    setIsDrawerVisible(true);
    setFolderLoading(true);
    
    const role = localStorage.getItem('role') || 'admin';
    const doctorName = localStorage.getItem('username');

    try {
      // Fetch all three domains of the patient's medical history
      const [consultRes, labRes, hospRes] = await Promise.all([
        client.get(`/patients/${patient.id}/folder?role=${role}&doctor_username=${doctorName}`),
        client.get(`/lab/patient/${patient.id}`).catch(() => ({ data: [] })), 
        client.get(`/hospitalizations/history?patient_id=${patient.id}`).catch(() => ({ data: [] })) 
      ]);

      setHistoryData(consultRes.data || []);
      
      const completedLabs = (labRes.data || []).filter(order => ['Completed', 'Validated'].includes(order.status) && order.results);
      setLabResults(completedLabs);
      
      setHospitalizationData(hospRes.data || []);
      
    } catch (error) {
      if (error.response && error.response.status === 403) {
        message.error("Access denied: Medical confidentiality.");
      } else {
        message.warning("Folder partially loaded.");
      }
    } finally {
      setFolderLoading(false);
    }
  };

  const columns = [
    {
      title: 'NSS',
      dataIndex: 'nss',
      render: (nss, record) => (
        <Space><IdcardOutlined style={{ color: '#1890ff' }} /><Text strong>{nss || `PT-000${record.id}`}</Text></Space>
      )
    },
    { title: 'Full Name', render: (_, record) => <Text strong style={{ fontSize: 15 }}>{record.first_name} {record.last_name}</Text> },
    {
      title: 'Date of Birth',
      dataIndex: 'date_of_birth',
      render: (dob) => (
        <Tag color="purple">
          {dob ? dayjs(dob).format('DD/MM/YYYY') : 'N/A'}
        </Tag>
      )
    },
    { title: 'Gender', dataIndex: 'gender', render: (gender) => <Tag color={gender === 'Male' || gender === 'M' ? 'blue' : 'magenta'}>{gender}</Tag> },
    { title: 'Wilaya', dataIndex: 'wilaya', render: (wilaya) => <Tag color="cyan">Code: {wilaya || 'N/A'}</Tag> },
    { title: 'Phone', dataIndex: 'phone' },
    {
      title: 'Action',
      align: 'center',
      render: (_, record) => (
        <Button type="primary" icon={<FolderOpenOutlined />} onClick={() => openMedicalFolder(record)} style={{ borderRadius: 6, fontWeight: 600 }}>
          Folder
        </Button>
      )
    }
  ];

  // --- DRAWER TABS CONTENT ---

  const renderConsultations = () => {
    if (historyData.length === 0) return <Empty description="No consultations recorded." style={{ margin: '40px 0' }} />;
    return (
      <Timeline mode="left" style={{ marginTop: '20px' }}>
        {historyData.map((record, index) => (
          <Timeline.Item 
            color="blue" 
            key={index} 
            label={<><ClockCircleOutlined /> <Text strong>{dayjs(record.scheduled_time).format('DD MMM YYYY')}</Text> <br/><Text type="secondary">{dayjs(record.scheduled_time).format('HH:mm')}</Text></>}
          >
            <Card size="small" style={{ backgroundColor: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <Tag color="blue" icon={<MedicineBoxOutlined />}>Dr. {record.doctor_name ? record.doctor_name.toUpperCase() : 'Unknown'}</Tag>
                <Tag color="cyan">{record.doctor_specialty || record.service || 'Consultation'}</Tag>
              </div>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ marginBottom: '8px' }}>
                <Text type="secondary">Confirmed Diagnosis:</Text><br/>
                <Text strong style={{ fontSize: '15px' }}>{record.diagnosis || 'Not specified'}</Text>
              </div>
              <div>
                <Text type="secondary">Prescription:</Text><br/>
                <div style={{ backgroundColor: '#ffffff', padding: '10px', borderRadius: '6px', borderLeft: '3px solid #52c41a', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                  {record.treatment || 'No treatment recorded'}
                </div>
              </div>
            </Card>
          </Timeline.Item>
        ))}
      </Timeline>
    );
  };

  const renderLabResults = () => {
    if (labResults.length === 0) return <Empty description="No lab results found." style={{ margin: '40px 0' }} />;
    
    return (
      <div style={{ marginTop: 20 }}>
        {labResults.map(order => {
          let results = [];
          try {
            results = typeof order.results === 'string' ? JSON.parse(order.results) : order.results;
          } catch(e) {}

          return (
            <Card 
              key={order.id} 
              size="small" 
              title={<Space><ExperimentOutlined style={{ color: '#722ed1' }} /> <Text strong>{order.test_name}</Text></Space>}
              extra={<Text type="secondary">{dayjs(order.ordered_at).format('DD/MM/YYYY')}</Text>}
              style={{ marginBottom: 16, borderRadius: 8, border: '1px solid #d3adf7' }}
              headStyle={{ background: '#f9f0ff' }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>Validated by: {order.lab_tech_name || 'Laboratory'}</Text>
              <Divider style={{ margin: '8px 0' }} />
              <Table
                dataSource={results}
                rowKey="parameter"
                pagination={false}
                size="small"
                columns={[
                  { title: 'Parameter', dataIndex: 'parameter', key: 'parameter' },
                  { title: 'Result', dataIndex: 'value', key: 'value', render: (val, r) => (
                      <Text strong style={{ color: r.flag === 'H' || r.flag === '!' ? '#cf1322' : r.flag === 'L' ? '#1890ff' : '#000' }}>
                        {val}
                      </Text>
                  )},
                  { title: 'Unit', dataIndex: 'unit', key: 'unit' },
                  { title: 'Ref.', key: 'ref', render: (_, r) => <Text type="secondary" style={{ fontSize: 11 }}>{r.ref_min} - {r.ref_max}</Text> },
                  { title: 'Indicator', dataIndex: 'flag', key: 'flag', render: f => {
                      if (f === 'H') return <Tag color="red">↑ High</Tag>;
                      if (f === 'L') return <Tag color="blue">↓ Low</Tag>;
                      if (f === '!') return <Tag color="magenta">⚠ CRITICAL</Tag>;
                      return <Tag color="green">Normal</Tag>;
                  }}
                ]}
              />
            </Card>
          );
        })}
      </div>
    );
  };

  const renderHospitalizations = () => {
    if (hospitalizationData.length === 0) return <Empty description="No hospitalization history." style={{ margin: '40px 0' }} />;
    return (
      <Timeline mode="left" style={{ marginTop: '20px' }}>
        {hospitalizationData.map((hosp, index) => {
          const isDischarged = hosp.status === 'Discharged';
          let durationText = '';
          if (isDischarged && hosp.discharge_date && hosp.admission_date) {
            const start = dayjs(hosp.admission_date);
            const end = dayjs(hosp.discharge_date);
            const days = end.diff(start, 'day');
            const hours = end.diff(start, 'hour') % 24;
            let displayDur = [];
            if (days > 0) displayDur.push(`${days} day(s)`);
            if (hours > 0) displayDur.push(`${hours} hour(s)`);
            if (displayDur.length === 0) displayDur.push('less than an hour');
            durationText = ` - Duration: ${displayDur.join(' and ')}`;
          }

          return (
          <Timeline.Item 
            color={isDischarged ? 'gray' : 'green'} 
            key={index} 
            label={<Text strong>{dayjs(hosp.admission_date).format('DD MMM YYYY HH:mm')}</Text>}
          >
            <Card size="small" style={{ backgroundColor: isDischarged ? '#fafafa' : '#f6ffed', border: `1px solid ${isDischarged ? '#d9d9d9' : '#b7eb8f'}`, borderRadius: '8px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <Text strong style={{ fontSize: 16, color: isDischarged ? '#595959' : '#389e0d', whiteSpace: 'nowrap' }}>
                  {hosp.department} - {hosp.room_name} ({hosp.bed_number})
                </Text>
                {isDischarged ? (
                  <Tag color="default" style={{ margin: 0, whiteSpace: 'normal', height: 'auto', padding: '4px 8px' }}>
                    Discharged on {hosp.discharge_date ? dayjs(hosp.discharge_date).format('DD/MM/YYYY HH:mm') : '—'}
                    <span style={{ fontWeight: 'bold', marginLeft: 8 }}>{durationText}</span>
                  </Tag>
                ) : (
                  <Badge status="processing" text={<Text type="success" strong>Currently Hospitalized</Text>} />
                )}
              </div>
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary">Attending Doctor: Dr. {hosp.doctor_name}</Text>
            </Card>
          </Timeline.Item>
        )})}
      </Timeline>
    );
  };

  const drawerTabItems = [
    { key: "1", label: <span><MedicineBoxOutlined /> Consultations</span>, children: renderConsultations() },
    { key: "2", label: <span><ExperimentOutlined /> Lab Results</span>, children: renderLabResults() },
    { key: "3", label: <span><AppstoreOutlined /> Hospitalizations</span>, children: renderHospitalizations() }
  ];

  return (
    <div style={{ animation: 'fadeIn 0.5s' }}>
      <Card title={<Space><TeamOutlined style={{ fontSize: '28px', color: '#1890ff' }} /><Title level={3} style={{ margin: 0 }}>Patient Directory</Title></Space>} extra={<Button icon={<ReloadOutlined />} onClick={fetchPatients} loading={loading}>Refresh</Button>}>
        <Row style={{ marginBottom: '20px' }}>
          <Col span={24}>
            <Input size="large" placeholder="Search by Name or NSS..." prefix={<SearchOutlined />} value={searchText} onChange={(e) => setSearchText(e.target.value)} allowClear style={{ borderRadius: 8 }} />
          </Col>
        </Row>
        <Table columns={columns} dataSource={filteredPatients} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} bordered size="middle" />
      </Card>

      {/* ─── NEW ENTERPRISE DRAWER FOR MEDICAL FOLDER ─── */}
      <Drawer
        title={
          viewingPatient ? (
            <Space>
              <FolderOpenOutlined style={{ color: '#1890ff', fontSize: 24 }} />
              <div>
                <Text strong style={{ fontSize: 20, display: 'block', lineHeight: 1.2 }}>{viewingPatient.first_name} {viewingPatient.last_name}</Text>
                <Text type="secondary" style={{ fontSize: 13 }}>NSS: {viewingPatient.nss || `PT-000${viewingPatient.id}`}</Text>
              </div>
            </Space>
          ) : "Medical Folder"
        }
        placement="right"
        width={750}
        onClose={() => setIsDrawerVisible(false)}
        open={isDrawerVisible}
        bodyStyle={{ padding: '0 24px 24px 24px', background: '#f5f7fa' }}
        headerStyle={{ borderBottom: '2px solid #1890ff' }}
      >
        {folderLoading ? (
          <div style={{ textAlign: 'center', marginTop: 100 }}><Spin size="large" tip="Loading medical folder..." /></div>
        ) : (
          <Tabs defaultActiveKey="1" items={drawerTabItems} size="large" />
        )}
      </Drawer>
    </div>
  );
};

export default PatientList;