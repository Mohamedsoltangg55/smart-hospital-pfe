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
      message.error("Erreur de connexion au serveur.");
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
        message.success("Profil mis à jour avec succès !");
      } else {
        await client.post('/users/', payload);
        message.success("Nouveau membre ajouté avec succès !");
      }
      
      setIsModalOpen(false);
      fetchData(); 
    } catch (error) { 
      message.error(error.response?.data?.detail || "Erreur lors de la sauvegarde.");
    }
  };

  const handleDelete = async (id) => {
    try {
      await client.delete(`/users/${id}`);
      message.success("Compte supprimé.");
      fetchData();
    } catch (error) { message.error("La suppression nécessite une route DELETE."); }
  };

  const columns = [
    { 
      title: 'Identité', 
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
      title: 'Date de Naissance', 
      dataIndex: 'date_of_birth', 
      key: 'date_of_birth', 
      render: text => text ? <Tag icon={<CalendarOutlined />}>{dayjs(text).format('DD/MM/YYYY')}</Tag> : <Text type="secondary">-</Text> 
    },
    { 
      title: 'Pôle Assigné', 
      dataIndex: 'specialty', 
      key: 'specialty', 
      render: text => <Tag color="purple" style={{ fontSize: '13px' }}>{text || 'Non assigné'}</Tag> 
    },
    { 
      title: 'Rôle', 
      dataIndex: 'role', 
      key: 'role', 
      render: role => {
        if (role === 'admin') return <Tag color="red" icon={<SafetyCertificateOutlined />}>Admin</Tag>;
        if (role === 'doctor') return <Tag color="blue" icon={<TeamOutlined />}>Médecin</Tag>;
        if (role === 'nurse') return <Tag color="cyan" icon={<TeamOutlined />}>Infirmier</Tag>;
        if (role === 'reception') return <Tag color="green" icon={<DesktopOutlined />}>Réception</Tag>;
        return <Tag>{role}</Tag>;
      } 
    },
    { 
      title: 'Actions', 
      key: 'action', 
      align: 'center', 
      render: (_, record) => (
        <Space size="middle">
          <Button type="primary" ghost icon={<EditOutlined />} onClick={() => openEditModal(record)}>Gérer</Button>
          <Popconfirm title="Supprimer ce compte ?" onConfirm={() => handleDelete(record.id)} okText="Oui" cancelText="Non">
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
          <Title level={2} style={{ margin: 0, color: '#111827', fontWeight: 700 }}><TeamOutlined style={{ color: '#4F46E5', marginRight: '10px' }} /> Gestion du Personnel</Title>
          <Text style={{ color: '#6B7280', fontSize: '15px' }}>Gérez les accès, les profils complets et les départements du staff.</Text>
        </div>
        <Button type="primary" size="large" icon={<UserAddOutlined />} onClick={openNewModal} style={{ backgroundColor: '#4F46E5', borderRadius: '8px' }}>Nouveau Membre</Button>
      </div>

      <Card style={{ borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: 'none' }}>
        <Table dataSource={users} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 8 }} />
      </Card>

      <Modal 
        title={editingUser ? <><EditOutlined style={{ color: '#1890ff' }} /> Gérer le Profil : {editingUser.username}</> : "Créer un nouveau compte"} 
        open={isModalOpen} 
        onCancel={() => setIsModalOpen(false)} 
        onOk={() => form.submit()} 
        okText="Sauvegarder les modifications" 
        cancelText="Annuler"
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleSave} style={{ marginTop: '20px' }}>
          
          <Divider orientation="left">Identité & Accès</Divider>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="full_name" label="Nom Complet" rules={[{ required: true }]}><Input placeholder="Ex: Dr. Amina Youssef" /></Form.Item></Col>
            <Col span={12}><Form.Item name="username" label="Nom d'utilisateur (Login)" rules={[{ required: true }]}><Input placeholder="Ex: dr.amina" /></Form.Item></Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}><Form.Item name="date_of_birth" label="Date de Naissance"><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder="Sélectionner une date" /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="password" label={editingUser ? "Nouveau mot de passe" : "Mot de passe"} rules={[{ required: !editingUser, message: "Requis pour un nouveau compte" }]} extra={editingUser ? "Laissez vide pour conserver l'ancien mot de passe" : ""}>
                <Input.Password placeholder={editingUser ? "Modifier le mot de passe..." : "Créer un mot de passe"} />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">Affectation Médicale</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="role" label="Rôle d'Accès" rules={[{ required: true }]}>
                <Select>
                  <Option value="doctor">Médecin</Option>
                  <Option value="nurse">Infirmier</Option>
                  <Option value="reception">Réceptionniste / Triage</Option>
                  <Option value="admin">Administrateur</Option>
                  <Option value="lab_tech">Technicien de Laboratoire</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="specialty" label="Département Assigné (Pôle)">
                <Select placeholder="Choisir un pôle" allowClear>
                  {services.map(s => <Option key={s.id || s.name} value={s.name}>{s.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}><Col span={12}><Form.Item name="phone" label="Numéro de Téléphone"><Input placeholder="05..." /></Form.Item></Col></Row>
        </Form>
      </Modal>
    </div>
  );
};

export default StaffManagement;