import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Typography, Tag, Space, Modal, Form, Input, Select, Popconfirm, message, Row, Col, Avatar, DatePicker, Divider } from 'antd';
import { TeamOutlined, UserAddOutlined, EditOutlined, DeleteOutlined, UserOutlined, SafetyCertificateOutlined, EnvironmentOutlined, DesktopOutlined, CalendarOutlined } from '@ant-design/icons';
import client from '../api/client';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

const StaffManagement = () => {
  const [users, setUsers] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, settingsRes] = await Promise.all([
        client.get('/users/'), 
        client.get('/settings')
      ]);
      setUsers(usersRes.data);

      if (settingsRes.data && settingsRes.data.services) {
        try {
          const parsedServices = JSON.parse(settingsRes.data.services);
          // 🧠 THE FIX: Convert strings to objects so s.name works!
          const normalizedServices = parsedServices.map(s => typeof s === 'string' ? { id: s, name: s } : s);
          setServices(normalizedServices.filter(s => s.status !== 'Inactif'));
        } catch (e) { setServices([]); }
      }
    } catch (error) {
      message.error("Server connection error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openNewModal = () => {
    setEditingUser(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const openEditModal = (record) => {
    setEditingUser(record);
    form.setFieldsValue({
      username: record.username,
      full_name: record.full_name,
      specialty: record.specialty,
      phone: record.phone,
      role: record.role || 'doctor',
      date_of_birth: record.date_of_birth ? dayjs(record.date_of_birth) : null,
      password: "" 
    });
    setIsModalOpen(true);
  };

  const handleSave = async (values) => {
    try {
      const payload = { ...values };
      if (values.date_of_birth) {
        payload.date_of_birth = values.date_of_birth.format('YYYY-MM-DD');
      }
      if (editingUser && !values.password) {
        delete payload.password;
      }

      if (editingUser) {
        await client.patch(`/users/${editingUser.id}`, payload);
        message.success("Profile updated successfully!");
      } else {
        await client.post('/users/', payload);
        message.success("New member added successfully!");
      }

      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      message.error(error.response?.data?.detail || "Error while saving.");
    }
  };

  const handleDelete = async (id) => {
    try {
      await client.delete(`/users/${id}`);
      message.success("Account deleted.");
      fetchData();
    } catch (error) { message.error("Deletion requires a DELETE route."); }
  };

  const columns = [
    {
      title: 'Identity',
      key: 'identity',
      render: (_, record) => (
        <Space>
          <Avatar style={{ backgroundColor: record.role === 'admin' ? '#cf1322' : record.role === 'reception' ? '#52c41a' : '#1890ff' }} icon={<UserOutlined />} />
          <div>
            <Text strong>{record.full_name || record.username.toUpperCase()}</Text><br/>
            <Text type="secondary" style={{ fontSize: '12px' }}>@{record.username}</Text>
          </div>
        </Space>
      ) 
    },
    {
      title: 'Date of Birth',
      dataIndex: 'date_of_birth',
      key: 'date_of_birth',
      render: text => text ? <Tag icon={<CalendarOutlined />}>{dayjs(text).format('DD/MM/YYYY')}</Tag> : <Text type="secondary">-</Text>
    },
    {
      title: 'Assigned Department',
      dataIndex: 'specialty',
      key: 'specialty',
      render: text => <Tag color="purple" style={{ fontSize: '13px' }}>{text || 'Unassigned'}</Tag>
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: role => {
        if (role === 'admin') return <Tag color="red" icon={<SafetyCertificateOutlined />}>Admin</Tag>;
        if (role === 'doctor') return <Tag color="blue" icon={<TeamOutlined />}>Doctor</Tag>;
        if (role === 'nurse') return <Tag color="cyan" icon={<TeamOutlined />}>Nurse</Tag>;
        if (role === 'reception') return <Tag color="green" icon={<DesktopOutlined />}>Reception</Tag>;
        return <Tag>{role}</Tag>;
      }
    },
    { 
      title: 'Actions', 
      key: 'action', 
      align: 'center', 
      render: (_, record) => (
        <Space size="middle">
          <Button type="primary" ghost icon={<EditOutlined />} onClick={() => openEditModal(record)}>Manage</Button>
          <Popconfirm title="Delete this account?" onConfirm={() => handleDelete(record.id)} okText="Yes" cancelText="No">
            <Button danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) 
    }
  ];

  return (
    <div style={{ padding: '30px', backgroundColor: '#F3F4F6', minHeight: '100vh', animation: 'fadeIn 0.5s' }}>
      <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#111827', fontWeight: 700 }}><TeamOutlined style={{ color: '#4F46E5', marginRight: '10px' }} /> Staff Management</Title>
          <Text style={{ color: '#6B7280', fontSize: '15px' }}>Manage access, full profiles and staff departments.</Text>
        </div>
        <Button type="primary" size="large" icon={<UserAddOutlined />} onClick={openNewModal} style={{ backgroundColor: '#4F46E5', borderRadius: '8px' }}>New Member</Button>
      </div>

      <Card style={{ borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: 'none' }}>
        <Table dataSource={users} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 8 }} />
      </Card>

      <Modal 
        title={editingUser ? <><EditOutlined style={{ color: '#1890ff' }} /> Manage Profile: {editingUser.username}</> : "Create a new account"}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        okText="Save changes"
        cancelText="Cancel"
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleSave} style={{ marginTop: '20px' }}>

          <Divider orientation="left">Identity & Access</Divider>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}><Input placeholder="e.g. Dr. Amina Youssef" /></Form.Item></Col>
            <Col span={12}><Form.Item name="username" label="Username (Login)" rules={[{ required: true }]}><Input placeholder="e.g. dr.amina" autoComplete="off" /></Form.Item></Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}><Form.Item name="date_of_birth" label="Date of Birth"><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder="Select a date" /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="password" label={editingUser ? "New password" : "Password"} rules={[{ required: !editingUser, message: "Required for a new account" }]} extra={editingUser ? "Leave blank to keep the current password" : ""}>
                <Input.Password autoComplete="new-password" placeholder={editingUser ? "Change the password..." : "Create a password"} />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">Medical Assignment</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="role" label="Access Role" rules={[{ required: true }]}>
                <Select>
                  <Option value="doctor">Doctor</Option>
                  <Option value="nurse">Nurse</Option>
                  <Option value="reception">Receptionist / Triage</Option>
                  <Option value="admin">Administrator</Option>
                  <Option value="lab_tech">Lab Technician</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="specialty" label="Assigned Department">
                <Select placeholder="Select a department" allowClear>
                  {services.map(s => <Option key={s.id || s.name} value={s.name}>{s.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}><Col span={12}><Form.Item name="phone" label="Phone Number"><Input placeholder="05..." /></Form.Item></Col></Row>
        </Form>
      </Modal>
    </div>
  );
};

export default StaffManagement;