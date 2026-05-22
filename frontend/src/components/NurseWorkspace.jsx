import React, { useState, useEffect, useCallback } from 'react';
import { 
  Card, Typography, Row, Col, Statistic, List, Checkbox, 
  Tag, Space, Button, Badge, Divider, message, Spin, Empty 
} from 'antd';
import { 
  HeartOutlined, CheckCircleOutlined, ClockCircleOutlined, 
  UserOutlined, SyncOutlined, MedicineBoxOutlined, AlertOutlined 
} from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const NurseWorkspace = () => {
  const [hospitalizations, setHospitalizations] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const nurseName = localStorage.getItem('username') || 'Nurse';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const t = new Date().getTime();
      
      // Fetch Occupied Beds and Nursing Tasks
      const [hospRes, tasksRes] = await Promise.all([
        client.get(`/hospitalizations/active?t=${t}`),
        client.get(`/nursing-tasks?t=${t}`)
      ]);

      setHospitalizations(hospRes.data || []);
      
      // Sort tasks: Pending first, then by newest
      const sortedTasks = (tasksRes.data || []).sort((a, b) => {
        if (a.status === 'Pending' && b.status !== 'Pending') return -1;
        if (a.status !== 'Pending' && b.status === 'Pending') return 1;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
      
      setTasks(sortedTasks);
    } catch (error) {
      console.error("Sync error:", error);
      message.error("Unable to load ward data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 10 seconds to catch new doctor orders
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCompleteTask = async (taskId) => {
    try {
      // Mark task as completed in the backend
      await client.patch(`/nursing-tasks/${taskId}/status`, { 
        status: 'Completed',
        completed_by: nurseName 
      });
      
      message.success("Task marked as completed!");
      fetchData(); // Refresh the lists
    } catch (error) {
      message.error("Error while updating the task.");
      console.error(error);
    }
  };

  const pendingTasks = tasks.filter(t => t.status === 'Pending');
  const completedTasks = tasks.filter(t => t.status === 'Completed');

  if (loading && hospitalizations.length === 0) {
    return <div style={{ textAlign: 'center', marginTop: 100 }}><Spin size="large" /></div>;
  }

  return (
    <div style={{ padding: '24px', background: '#f5f7fa', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>
      
      {/* ── HEADER ── */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#141414' }}>
            <HeartOutlined style={{ color: '#eb2f96', marginRight: 12 }} />
            Nursing Station
          </Title>
          <Text type="secondary" style={{ fontSize: 15 }}>Monitoring of inpatients and execution of medical prescriptions.</Text>
        </div>
        <Button icon={<SyncOutlined />} onClick={fetchData} loading={loading} size="large" style={{ borderRadius: 8 }}>
          Refresh
        </Button>
      </div>

      {/* ── KPI STATISTICS ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card style={{ borderRadius: 12, background: '#e6f7ff', borderLeft: '5px solid #1890ff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic 
              title={<Text style={{ color: '#0050b3', fontWeight: 600 }}>Inpatients (Occupied Beds)</Text>}
              value={hospitalizations.length} 
              prefix={<UserOutlined style={{ color: '#1890ff' }} />} 
              valueStyle={{ color: '#1890ff', fontWeight: 800, fontSize: 32 }} 
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ borderRadius: 12, background: '#fff1f0', borderLeft: '5px solid #ff4d4f', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic 
              title={<Text style={{ color: '#a8071a', fontWeight: 600 }}>Pending Medical Tasks</Text>}
              value={pendingTasks.length} 
              prefix={<AlertOutlined style={{ color: '#ff4d4f' }} />} 
              valueStyle={{ color: '#ff4d4f', fontWeight: 800, fontSize: 32 }} 
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ borderRadius: 12, background: '#f6ffed', borderLeft: '5px solid #52c41a', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic 
              title={<Text style={{ color: '#237804', fontWeight: 600 }}>Completed Care (Today)</Text>}
              value={completedTasks.length} 
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} 
              valueStyle={{ color: '#52c41a', fontWeight: 800, fontSize: 32 }} 
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={24}>
        {/* ── LEFT: OCCUPIED BEDS MAP ── */}
        <Col span={14}>
          <Card 
            title={
              <Space>
                <UserOutlined style={{ color: '#1890ff' }} />
                <span style={{ fontWeight: 700 }}>Occupied Beds Map</span>
              </Space>
            } 
            style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', minHeight: 500 }}
          >
            {hospitalizations.length === 0 ? (
              <Empty description="No patients currently hospitalized." image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Row gutter={[16, 16]}>
                {hospitalizations.map(hosp => (
                  <Col span={12} key={hosp.id}>
                    <Card 
                      size="small" 
                      style={{ 
                        border: '1px solid #91d5ff', 
                        background: '#e6f7ff', 
                        borderRadius: 8 
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <Badge status="processing" text={<Text strong style={{ fontSize: 16 }}>{hosp.patient_name}</Text>} />
                          <div style={{ marginTop: 8 }}>
                            <Tag color="blue">{hosp.department}</Tag>
                            <Tag color="cyan">{hosp.room_name}</Tag>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <Text style={{ fontSize: 18, fontWeight: 800, color: '#1890ff' }}>{hosp.bed_number}</Text>
                        </div>
                      </div>
                      <Divider style={{ margin: '10px 0' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <Text type="secondary">Admitted: {dayjs(hosp.admission_date).format('DD/MM HH:mm')}</Text>
                        <Text strong type="secondary">Dr. {hosp.doctor_name}</Text>
                      </div>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>

        {/* ── RIGHT: NURSING TASKS CHECKLIST ── */}
        <Col span={10}>
          <Card 
            title={
              <Space>
                <MedicineBoxOutlined style={{ color: '#eb2f96' }} />
                <span style={{ fontWeight: 700 }}>Prescriptions & Tasks To Do</span>
              </Space>
            } 
            style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', minHeight: 500 }}
            bodyStyle={{ padding: 0 }}
          >
            <List
              itemLayout="horizontal"
              dataSource={tasks}
              locale={{ emptyText: <Empty description="No pending medical tasks." /> }}
              renderItem={task => (
                <List.Item 
                  style={{ 
                    padding: '16px 24px', 
                    background: task.status === 'Completed' ? '#fafafa' : '#fff',
                    borderLeft: task.status === 'Completed' ? '4px solid #d9d9d9' : '4px solid #eb2f96',
                    borderBottom: '1px solid #f0f0f0'
                  }}
                  actions={[
                    task.status === 'Pending' ? (
                      <Button 
                        type="primary" 
                        size="small" 
                        icon={<CheckCircleOutlined />} 
                        onClick={() => handleCompleteTask(task.id)}
                        style={{ background: '#52c41a', borderColor: '#52c41a', borderRadius: 6 }}
                      >
                        Complete
                      </Button>
                    ) : (
                      <Tag color="default" icon={<CheckCircleOutlined />}>Done</Tag>
                    )
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Text 
                          strong 
                          delete={task.status === 'Completed'}
                          style={{ color: task.status === 'Completed' ? '#bfbfbf' : '#262626' }}
                        >
                          {task.patient_name}
                        </Text>
                        {task.room_number && <Tag color="purple">{task.room_number}</Tag>}
                      </div>
                    }
                    description={
                      <div style={{ marginTop: 4 }}>
                        <Text style={{ color: task.status === 'Completed' ? '#bfbfbf' : '#595959' }}>
                          {task.task_description}
                        </Text>
                        <div style={{ marginTop: 8, fontSize: 11, color: '#bfbfbf' }}>
                          <ClockCircleOutlined style={{ marginRight: 4 }} />
                          {dayjs(task.created_at).format('DD/MM/YYYY HH:mm')}
                        </div>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default NurseWorkspace;