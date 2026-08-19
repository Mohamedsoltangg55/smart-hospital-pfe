import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Typography, message, Row, Col, Tabs, Tag, Space, Popconfirm, Table, Modal, Select, InputNumber } from 'antd';
import { SettingOutlined, AppstoreAddOutlined, BankOutlined, SaveOutlined, PlusOutlined, DeleteOutlined, EditOutlined, DollarOutlined, TagsOutlined } from '@ant-design/icons';
import client from '../api/client';

const { Title, Text } = Typography;
const { Option } = Select;

const AdminSettings = () => {
  const [form] = Form.useForm();
  const [serviceForm] = Form.useForm();
  const [roomForm] = Form.useForm();
  const [priceForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  
  const [services, setServices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [prices, setPrices] = useState([]); 

  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [editingRoomId, setEditingRoomId] = useState(null);
  const [editingPriceId, setEditingPriceId] = useState(null);

  // 🧠 THE SUPER-PARSER (Indestructible)
  const superParse = (data) => {
    if (!data || data === "[]" || data === "") return [];
    if (Array.isArray(data)) return data;
    
    try {
      let parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      try {
        const fixedData = data.replace(/'/g, '"');
        return JSON.parse(fixedData);
      } catch (err) {
        console.error("Fatal error reading data:", data);
        return [];
      }
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await client.get(`/settings?t=${new Date().getTime()}`);
      if (res.data) {
        form.setFieldsValue({
          hospital_name: res.data.hospital_name || 'Smart Clinic',
          tv_announcement: res.data.tv_announcement || 'Welcome.'
        });

        setServices(superParse(res.data.services));
        setRooms(superParse(res.data.rooms));
        setPrices(superParse(res.data.prices));
      }
    } catch (error) {
      console.error("Fetch error:", error);
      message.error("Server connection error.");
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const forceSaveToDatabase = async (currentServices, currentRooms, currentPrices) => {
    try {
      const payload = {
        hospital_name: form.getFieldValue('hospital_name') || 'Smart Clinic',
        tv_announcement: form.getFieldValue('tv_announcement') || 'Welcome',
        services: JSON.stringify(currentServices),
        rooms: JSON.stringify(currentRooms),
        prices: JSON.stringify(currentPrices)
      };
      await client.patch('/settings', payload);
      return true;
    } catch (error) {
      message.error("Error while saving.");
      return false;
    }
  };

  const handleSaveAll = async () => {
    setLoading(true);
    await forceSaveToDatabase(services, rooms, prices);
    message.success("Everything saved!");
    setLoading(false);
  };

  // --- ROOMS LOGIC ---
  const openEditRoomModal = (record = null) => {
    if (services.length === 0) return message.warning("Create a Medical Department first!");
    setEditingRoomId(record ? record.id : null);
    if (record) roomForm.setFieldsValue(record); else roomForm.resetFields();
    setIsRoomModalOpen(true);
  };

  const handleSaveRoom = async (values) => {
    const updated = editingRoomId 
      ? rooms.map(r => r.id === editingRoomId ? { ...r, ...values } : r) 
      : [...rooms, { id: Date.now(), ...values }];
    setRooms(updated);
    setIsRoomModalOpen(false);
    await forceSaveToDatabase(services, updated, prices);
    message.success("Room saved!");
  };

  const handleDeleteRoom = async (id) => {
    const updated = rooms.filter(r => r.id !== id);
    setRooms(updated);
    await forceSaveToDatabase(services, updated, prices);
    message.success("Room deleted.");
  };

  // --- DEPARTMENTS LOGIC ---
  const handleSaveService = async (v) => {
    const updated = [...services, { id: Date.now(), ...v }];
    setServices(updated);
    setIsServiceModalOpen(false);
    await forceSaveToDatabase(updated, rooms, prices);
    message.success("Department added!");
  };

  // --- 💰 PRICING LOGIC (PRICES) ---
  const openEditPriceModal = (record = null) => {
    setEditingPriceId(record ? record.id : null);
    if (record) priceForm.setFieldsValue(record); else priceForm.resetFields();
    setIsPriceModalOpen(true);
  };

  const handleSavePrice = async (values) => {
    const updated = editingPriceId 
      ? prices.map(p => p.id === editingPriceId ? { ...p, ...values } : p) 
      : [...prices, { id: Date.now(), ...values }];
    setPrices(updated);
    setIsPriceModalOpen(false);
    await forceSaveToDatabase(services, rooms, updated);
    message.success("Price saved to catalog!");
  };

  const handleDeletePrice = async (id) => {
    const updated = prices.filter(p => p.id !== id);
    setPrices(updated);
    await forceSaveToDatabase(services, rooms, updated);
    message.success("Price deleted.");
  };

  // --- COLUMNS ---
  const serviceColumns = [
    { title: 'Department', dataIndex: 'name', key: 'name' },
    { title: 'Actions', key: 'action', align: 'center', render: (_, record) => (
      <Popconfirm title="Delete?" onConfirm={() => {
        const updated = services.filter(s => s.id !== record.id);
        setServices(updated);
        forceSaveToDatabase(updated, rooms, prices);
      }}>
        <Button danger type="text" icon={<DeleteOutlined />} />
      </Popconfirm>
    )}
  ];

  const roomColumns = [
    { title: 'Identifier', dataIndex: 'name', key: 'name', render: t => <b>{t}</b> },
    { title: 'Department', dataIndex: 'department', key: 'department', render: d => <Tag color="purple">{d}</Tag> },
    { title: 'Type', dataIndex: 'type', key: 'type', render: t => (
      <Tag color={t === 'Salle de Soins' || t === 'Infirmerie' ? 'magenta' : 'default'}>{t}</Tag>
    )},
    { title: 'Capacity / Slots', dataIndex: 'capacity', key: 'capacity' },
    { title: 'Actions', key: 'action', align: 'center', render: (_, record) => (
      <Space>
        <Button type="text" icon={<EditOutlined style={{ color: '#4F46E5' }} />} onClick={() => openEditRoomModal(record)} />
        <Popconfirm title="Delete?" onConfirm={() => handleDeleteRoom(record.id)}>
          <Button danger type="text" icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )}
  ];

  const priceColumns = [
    { title: 'Service Name', dataIndex: 'name', key: 'name', render: t => <b>{t}</b> },
    { title: 'Category', dataIndex: 'type', key: 'type', render: t => <Tag color={t === 'Laboratoire' ? 'purple' : 'blue'}>{t}</Tag> },
    { title: 'Price (DA)', dataIndex: 'amount', key: 'amount', render: a => <Text strong style={{ color: '#10B981' }}>{a} DA</Text> },
    { title: 'Actions', key: 'action', align: 'center', render: (_, record) => (
      <Space>
        <Button type="text" icon={<EditOutlined style={{ color: '#4F46E5' }} />} onClick={() => openEditPriceModal(record)} />
        <Popconfirm title="Delete?" onConfirm={() => handleDeletePrice(record.id)}>
          <Button danger type="text" icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )}
  ];

  const tabItems = [
    { key: "1", label: "Medical Departments", children: (
      <div style={{ padding: '20px 0' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsServiceModalOpen(true)} style={{ marginBottom: 20 }}>New Department</Button>
        <Table dataSource={services} columns={serviceColumns} rowKey="id" bordered />
      </div>
    )},
    { key: "2", label: "Rooms & Offices", children: (
      <div style={{ padding: '20px 0' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditRoomModal()} style={{ marginBottom: 20 }}>New Room</Button>
        <Table dataSource={rooms} columns={roomColumns} rowKey="id" bordered />
      </div>
    )},
    { key: "3", label: <span><TagsOutlined /> Pricing & Catalog</span>, children: (
      <div style={{ padding: '20px 0' }}>
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">Manage the prices of consultations and lab tests that appear at the cashier.</Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditPriceModal()} style={{ backgroundColor: '#10B981' }}>New Price</Button>
        </div>
        <Table dataSource={prices} columns={priceColumns} rowKey="id" bordered />
      </div>
    )},
    { key: "4", label: "General", children: (
      <div style={{ maxWidth: '600px', padding: '20px 0' }}>
        <Form form={form} layout="vertical">
          <Form.Item name="hospital_name" label="Facility Name"><Input /></Form.Item>
          <Form.Item name="tv_announcement" label="TV Announcement"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </div>
    )}
  ];

  return (
    <div style={{ padding: '30px', backgroundColor: '#F3F4F6', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 30 }}>
        <Title level={2}><SettingOutlined /> System Configuration</Title>
        <Button type="primary" size="large" icon={<SaveOutlined />} onClick={handleSaveAll} loading={loading} style={{ backgroundColor: '#10B981' }}>Save all</Button>
      </div>

      <Card style={{ borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <Tabs defaultActiveKey="3" items={tabItems} />
      </Card>

      {/* --- ROOMS MODAL --- */}
      <Modal title={editingRoomId ? "Edit Room" : "Add Room"} open={isRoomModalOpen} onOk={() => roomForm.submit()} onCancel={() => setIsRoomModalOpen(false)}>
        <Form form={roomForm} layout="vertical" onFinish={handleSaveRoom}>
          <Form.Item name="department" label="Medical Department" rules={[{ required: true }]}>
            <Select>{services.map(s => <Option key={s.id} value={s.name}>{s.name}</Option>)}</Select>
          </Form.Item>
          <Form.Item name="name" label="Room name" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="location" label="Floor" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="capacity" label="Capacity (Beds/Slots)" initialValue={1}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="type" label="Structure type" rules={[{ required: true }]}>
            <Select>
              <Option value="Cabinet Standard">Consultation Office</Option>
              <Option value="Chambre Hospitalisation">Hospitalisation Room</Option>
              <Option value="Salle de Soins">Treatment Room (Infirmary)</Option>
              <Option value="Infirmerie">Infirmary</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* --- DEPARTMENTS MODAL --- */}
      <Modal title="New Department" open={isServiceModalOpen} onOk={() => serviceForm.submit()} onCancel={() => setIsServiceModalOpen(false)}>
        <Form form={serviceForm} layout="vertical" onFinish={handleSaveService}>
          <Form.Item name="name" label="Department name" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      {/* --- PRICING MODAL --- */}
      <Modal title={editingPriceId ? "Edit Price" : "New Catalog Price"} open={isPriceModalOpen} onOk={() => priceForm.submit()} onCancel={() => setIsPriceModalOpen(false)}>
        <Form form={priceForm} layout="vertical" onFinish={handleSavePrice}>
          <Form.Item name="type" label="Service category" rules={[{ required: true, message: 'Required' }]}>
            <Select placeholder="Select the category">
              <Option value="Consultation">Consultation (Doctor)</Option>
              <Option value="Laboratoire">Laboratory Tests</Option>
            </Select>
          </Form.Item>
          <Form.Item name="name" label="Name (e.g. General Consultation, CBC, Nursing Care...)" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="Exact name of the service or test" />
          </Form.Item>
          <Form.Item name="amount" label="Service price (in DA)" rules={[{ required: true, message: 'Required' }]}>
            <InputNumber min={0} style={{ width: '100%' }} size="large" addonAfter="DA" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AdminSettings;