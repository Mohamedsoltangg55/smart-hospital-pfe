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

  // 🧠 LE SUPER-PARSEUR (Indestructible)
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
        console.error("Erreur fatale de lecture des données :", data);
        return [];
      }
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await client.get(`/settings?t=${new Date().getTime()}`);
      if (res.data) {
        form.setFieldsValue({
          hospital_name: res.data.hospital_name || 'Clinique Smart',
          tv_announcement: res.data.tv_announcement || 'Bienvenue.'
        });

        setServices(superParse(res.data.services));
        setRooms(superParse(res.data.rooms));
        setPrices(superParse(res.data.prices));
      }
    } catch (error) { 
      console.error("Erreur Fetch:", error);
      message.error("Erreur de connexion au serveur."); 
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const forceSaveToDatabase = async (currentServices, currentRooms, currentPrices) => {
    try {
      const payload = {
        hospital_name: form.getFieldValue('hospital_name') || 'Clinique Smart',
        tv_announcement: form.getFieldValue('tv_announcement') || 'Bienvenue',
        services: JSON.stringify(currentServices),
        rooms: JSON.stringify(currentRooms),
        prices: JSON.stringify(currentPrices)
      };
      await client.patch('/settings', payload);
      return true;
    } catch (error) {
      message.error("Erreur lors de la sauvegarde.");
      return false;
    }
  };

  const handleSaveAll = async () => {
    setLoading(true);
    await forceSaveToDatabase(services, rooms, prices);
    message.success("Tout est sauvegardé !");
    setLoading(false);
  };

  // --- LOGIQUE SALLES ---
  const openEditRoomModal = (record = null) => {
    if (services.length === 0) return message.warning("Créez d'abord un Pôle Médical !");
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
    message.success("Salle enregistrée !");
  };

  const handleDeleteRoom = async (id) => {
    const updated = rooms.filter(r => r.id !== id);
    setRooms(updated);
    await forceSaveToDatabase(services, updated, prices);
    message.success("Salle supprimée.");
  };

  // --- LOGIQUE POLES ---
  const handleSaveService = async (v) => {
    const updated = [...services, { id: Date.now(), ...v }];
    setServices(updated);
    setIsServiceModalOpen(false);
    await forceSaveToDatabase(updated, rooms, prices);
    message.success("Pôle ajouté !");
  };

  // --- 💰 NOUVELLE LOGIQUE TARIFICATION (PRICES) ---
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
    message.success("Tarif enregistré au catalogue !");
  };

  const handleDeletePrice = async (id) => {
    const updated = prices.filter(p => p.id !== id);
    setPrices(updated);
    await forceSaveToDatabase(services, rooms, updated);
    message.success("Tarif supprimé.");
  };

  // --- COLONNES ---
  const serviceColumns = [
    { title: 'Département', dataIndex: 'name', key: 'name' },
    { title: 'Actions', key: 'action', align: 'center', render: (_, record) => (
      <Popconfirm title="Supprimer ?" onConfirm={() => {
        const updated = services.filter(s => s.id !== record.id);
        setServices(updated);
        forceSaveToDatabase(updated, rooms, prices);
      }}>
        <Button danger type="text" icon={<DeleteOutlined />} />
      </Popconfirm>
    )}
  ];

  const roomColumns = [
    { title: 'Identifiant', dataIndex: 'name', key: 'name', render: t => <b>{t}</b> },
    { title: 'Pôle', dataIndex: 'department', key: 'department', render: d => <Tag color="purple">{d}</Tag> },
    { title: 'Type', dataIndex: 'type', key: 'type', render: t => (
      <Tag color={t === 'Salle de Soins' || t === 'Infirmerie' ? 'magenta' : 'default'}>{t}</Tag>
    )},
    { title: 'Capacité / Places', dataIndex: 'capacity', key: 'capacity' },
    { title: 'Actions', key: 'action', align: 'center', render: (_, record) => (
      <Space>
        <Button type="text" icon={<EditOutlined style={{ color: '#4F46E5' }} />} onClick={() => openEditRoomModal(record)} />
        <Popconfirm title="Supprimer ?" onConfirm={() => handleDeleteRoom(record.id)}>
          <Button danger type="text" icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )}
  ];

  const priceColumns = [
    { title: 'Désignation de l\'Acte', dataIndex: 'name', key: 'name', render: t => <b>{t}</b> },
    { title: 'Catégorie', dataIndex: 'type', key: 'type', render: t => <Tag color={t === 'Laboratoire' ? 'purple' : 'blue'}>{t}</Tag> },
    { title: 'Tarif (DA)', dataIndex: 'amount', key: 'amount', render: a => <Text strong style={{ color: '#10B981' }}>{a} DA</Text> },
    { title: 'Actions', key: 'action', align: 'center', render: (_, record) => (
      <Space>
        <Button type="text" icon={<EditOutlined style={{ color: '#4F46E5' }} />} onClick={() => openEditPriceModal(record)} />
        <Popconfirm title="Supprimer ?" onConfirm={() => handleDeletePrice(record.id)}>
          <Button danger type="text" icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )}
  ];

  const tabItems = [
    { key: "1", label: "Pôles Médicaux", children: (
      <div style={{ padding: '20px 0' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsServiceModalOpen(true)} style={{ marginBottom: 20 }}>Nouveau Pôle</Button>
        <Table dataSource={services} columns={serviceColumns} rowKey="id" bordered />
      </div>
    )},
    { key: "2", label: "Salles & Cabinets", children: (
      <div style={{ padding: '20px 0' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditRoomModal()} style={{ marginBottom: 20 }}>Nouvelle Salle</Button>
        <Table dataSource={rooms} columns={roomColumns} rowKey="id" bordered />
      </div>
    )},
    { key: "3", label: <span><TagsOutlined /> Tarification & Catalogue</span>, children: (
      <div style={{ padding: '20px 0' }}>
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">Gérez les prix des consultations et des actes de laboratoire qui apparaîtront à la caisse.</Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditPriceModal()} style={{ backgroundColor: '#10B981' }}>Nouveau Tarif</Button>
        </div>
        <Table dataSource={prices} columns={priceColumns} rowKey="id" bordered />
      </div>
    )},
    { key: "4", label: "Général", children: (
      <div style={{ maxWidth: '600px', padding: '20px 0' }}>
        <Form form={form} layout="vertical">
          <Form.Item name="hospital_name" label="Nom Établissement"><Input /></Form.Item>
          <Form.Item name="tv_announcement" label="Annonce TV"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </div>
    )}
  ];

  return (
    <div style={{ padding: '30px', backgroundColor: '#F3F4F6', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 30 }}>
        <Title level={2}><SettingOutlined /> Configuration Système</Title>
        <Button type="primary" size="large" icon={<SaveOutlined />} onClick={handleSaveAll} loading={loading} style={{ backgroundColor: '#10B981' }}>Sauvegarder tout</Button>
      </div>

      <Card style={{ borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <Tabs defaultActiveKey="3" items={tabItems} />
      </Card>

      {/* --- MODAL SALLES --- */}
      <Modal title={editingRoomId ? "Modifier Salle" : "Ajouter Salle"} open={isRoomModalOpen} onOk={() => roomForm.submit()} onCancel={() => setIsRoomModalOpen(false)}>
        <Form form={roomForm} layout="vertical" onFinish={handleSaveRoom}>
          <Form.Item name="department" label="Pôle Médical" rules={[{ required: true }]}>
            <Select>{services.map(s => <Option key={s.id} value={s.name}>{s.name}</Option>)}</Select>
          </Form.Item>
          <Form.Item name="name" label="Nom de la salle" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="location" label="Étage" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="capacity" label="Capacité (Lits/Places)" initialValue={1}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="type" label="Type de structure" rules={[{ required: true }]}>
            <Select>
              <Option value="Cabinet Standard">Cabinet de Consultation</Option>
              <Option value="Chambre Hospitalisation">Chambre d'Hospitalisation</Option>
              <Option value="Salle de Soins">Salle de Soins (Infirmerie)</Option>
              <Option value="Infirmerie">Infirmerie</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* --- MODAL POLES --- */}
      <Modal title="Nouveau Pôle" open={isServiceModalOpen} onOk={() => serviceForm.submit()} onCancel={() => setIsServiceModalOpen(false)}>
        <Form form={serviceForm} layout="vertical" onFinish={handleSaveService}>
          <Form.Item name="name" label="Nom du pôle" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      {/* --- MODAL TARIFICATION --- */}
      <Modal title={editingPriceId ? "Modifier le Tarif" : "Nouveau Tarif au Catalogue"} open={isPriceModalOpen} onOk={() => priceForm.submit()} onCancel={() => setIsPriceModalOpen(false)}>
        <Form form={priceForm} layout="vertical" onFinish={handleSavePrice}>
          <Form.Item name="type" label="Catégorie de l'acte" rules={[{ required: true, message: 'Requis' }]}>
            <Select placeholder="Choisir la catégorie">
              <Option value="Consultation">Consultation (Médecin)</Option>
              <Option value="Laboratoire">Analyses Laboratoire</Option>
            </Select>
          </Form.Item>
          <Form.Item name="name" label="Désignation (ex: Consultation Générale, FNS, Soins Infirmiers...)" rules={[{ required: true, message: 'Requis' }]}>
            <Input placeholder="Nom exact de l'acte ou de l'analyse" />
          </Form.Item>
          <Form.Item name="amount" label="Prix de l'acte (en DA)" rules={[{ required: true, message: 'Requis' }]}>
            <InputNumber min={0} style={{ width: '100%' }} size="large" addonAfter="DA" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AdminSettings;