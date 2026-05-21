import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Typography, Tag, Select, Button, Modal, Form, message, Empty, Spin, Space, Statistic, Divider, Tooltip } from 'antd';
import { MedicineBoxOutlined, UserOutlined, CheckCircleOutlined, SwapOutlined, SafetyCertificateOutlined, AppstoreOutlined } from '@ant-design/icons';
import client from '../api/client';
import useWebSocket from '../hooks/useWebSocket';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

const HospitalisationBeds = () => {
  const [rooms, setRooms] = useState([]);
  const [hospitalizations, setHospitalizations] = useState([]);
  const [patients, setPatients] = useState([]);
  const [departments, setDepartments] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState("ALL"); 
  const [userRole, setUserRole] = useState(null);

  // Modals state
  const [isAdmitModalOpen, setIsAdmitModalOpen] = useState(false);
  const [isOccupiedModalOpen, setIsOccupiedModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  
  const [selectedBed, setSelectedBed] = useState(null); // Keeps track of the clicked bed/patient
  const [form] = Form.useForm();
  const [transferForm] = Form.useForm();
  
  // Watch the selected room in the transfer form
  const selectedNewRoomValue = Form.useWatch('new_room', transferForm);

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
        return [];
      }
    }
  };

  const fetchData = async () => {
    try {
      const t = new Date().getTime();
      const [settingsRes, patientsRes, hospRes] = await Promise.all([
        client.get(`/settings?t=${t}`),
        client.get(`/patients/?t=${t}`),
        client.get(`/hospitalizations/active?t=${t}`) // Fetch initial state
      ]);

      setPatients(patientsRes.data);
      setHospitalizations(hospRes.data || []);
      setUserRole(localStorage.getItem('role') || 'admin');

      if (settingsRes.data) {
        setDepartments(superParse(settingsRes.data.services));
        // Filter out Cabinets, only keep hospitalization rooms
        const allRooms = superParse(settingsRes.data.rooms);
        setRooms(allRooms.filter(r => !r.type?.toLowerCase().includes("cabinet")));
      }
    } catch (error) { 
      console.error("Erreur de chargement Beds:", error);
    } finally { 
      setLoading(false); 
    }
  };

  // 🔌 WEBSOCKET: Real-time updates
  const handleHospitalizationMessage = (data) => {
    if (data.type === 'hospitalization_update') {
      setHospitalizations(data.hospitalizations || []);
    } else if (data.type === 'patient_admitted') {
      setHospitalizations(prev => [...prev, data]);
    } else if (data.type === 'patient_discharged') {
      setHospitalizations(prev => prev.filter(h => h.id !== data.hospitalization_id));
    }
  };

  useWebSocket(`/ws/hospitalizations`, handleHospitalizationMessage, []);

  useEffect(() => {
    fetchData();
  }, []);

  const handleBedClick = (room, bedName, activeHosp) => {
    setSelectedBed({ room, bedName, activeHosp });
    if (!activeHosp) {
      form.resetFields();
      setIsAdmitModalOpen(true);
    } else {
      setIsOccupiedModalOpen(true);
    }
  };

  // --- ADMIT PATIENT ---
  const handleAdmit = async (values) => {
    try {
      const patient = patients.find(p => p.id === values.patient_id);
      const payload = {
        patient_id: patient.id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
        department: selectedBed.room.department,
        room_name: selectedBed.room.name,
        bed_number: selectedBed.bedName,
        admission_date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        doctor_id: parseInt(localStorage.getItem('userId')) || 1, // Fallback to admin
        doctor_name: localStorage.getItem('username') || "Chef de Service"
      };
      await client.post('/hospitalizations/', payload);
      message.success("Patient installé avec succès !");
      setIsAdmitModalOpen(false);
      fetchData(); // Force refresh to ensure sync
    } catch (error) { 
      message.error("Erreur lors de l'installation."); 
    }
  };

  // --- DISCHARGE PATIENT ---
  const handleDischarge = () => {
    Modal.confirm({
      title: `Autoriser la sortie ?`,
      content: `Voulez-vous vraiment libérer le lit de ${selectedBed.activeHosp.patient_name} ?`,
      okText: 'Oui, Libérer',
      okButtonProps: { danger: true },
      cancelText: 'Annuler',
      onOk: async () => {
        try {
          await client.patch(`/hospitalizations/${selectedBed.activeHosp.id}/discharge`, {
            doctor_name: localStorage.getItem('username') || "Administration"
          });
          message.success("Lit libéré avec succès.");
          setIsOccupiedModalOpen(false);
          fetchData();
        } catch (e) {
          console.error("Discharge error:", e.response || e);
          message.error("Erreur de libération: " + (e.response?.data?.detail || e.message)); 
        }
      }
    });
  };

  // --- TRANSFER PATIENT ---
  const handleTransfer = async (values) => {
    try {
      const newRoomName = values.new_room.split('|')[1];
      const newDept = values.new_room.split('|')[0];
      
      // We do a mock transfer by updating the record directly.
      // If your backend doesn't have a /transfer route, we patch the existing record.
      // (Assuming your backend allows patching room_name and bed_number on active hospitalizations)
      
      message.loading({ content: "Transfert en cours...", key: "transfer" });
      
      // Because we don't have a specific transfer route in the backend instructions, 
      // the safest architectural way is to Discharge the old bed and Admit to the new bed silently, 
      // OR if your backend supports PUT/PATCH on hospitalizations, we use that. 
      // For now, let's assume we can PATCH the bed details:
      
      // NOTE: If this fails, your backend might need a specific transfer route.
      // As a workaround for now, we will simulate it safely:
      await client.patch(`/hospitalizations/${selectedBed.activeHosp.id}/discharge`, { doctor_name: "Transfer System" });
      
      await client.post('/hospitalizations/', {
        patient_id: selectedBed.activeHosp.patient_id,
        patient_name: selectedBed.activeHosp.patient_name,
        department: newDept,
        room_name: newRoomName,
        bed_number: values.new_bed,
        admission_date: selectedBed.activeHosp.admission_date, // Keep original admission date
        doctor_id: selectedBed.activeHosp.doctor_id,
        doctor_name: selectedBed.activeHosp.doctor_name
      });

      message.success({ content: "Patient transféré avec succès !", key: "transfer", duration: 2 });
      setIsTransferModalOpen(false);
      setIsOccupiedModalOpen(false);
      fetchData();
    } catch (e) {
      message.error({ content: "Échec du transfert.", key: "transfer" });
    }
  };

  const renderTransferBedOptions = () => {
    if (!selectedNewRoomValue) return <Option disabled>Veuillez choisir une salle</Option>;
    
    const newRoomName = selectedNewRoomValue.split('|')[1];
    const targetRoom = rooms.find(r => r.name === newRoomName);
    if (!targetRoom) return [];

    const capacity = targetRoom.capacity || 1;
    const beds = [];

    for (let i = 1; i <= capacity; i++) {
      const bedName = `Lit ${i.toString().padStart(2, '0')}`;
      const isOccupied = hospitalizations.some(h => h.room_name === newRoomName && h.bed_number === bedName);
      if (!isOccupied) { // Only show empty beds for transfer!
        beds.push(<Option key={bedName} value={bedName}>{bedName} 🟢 (Libre)</Option>);
      }
    }
    
    if (beds.length === 0) return <Option disabled>Aucun lit libre dans cette salle</Option>;
    return beds;
  };

  if (loading) return <div style={{ textAlign: 'center', marginTop: 100 }}><Spin size="large" /></div>;

  const displayedRooms = selectedDept === "ALL" ? rooms : rooms.filter(r => r.department === selectedDept);

  // Calculate Global Stats
  let totalBeds = 0;
  rooms.forEach(r => totalBeds += (parseInt(r.capacity) || 1));
  const occupiedBedsCount = hospitalizations.length;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBedsCount / totalBeds) * 100) : 0;

  return (
    <div style={{ padding: '24px', background: '#f5f7fa', minHeight: '100vh', animation: 'fadeIn 0.4s' }}>
      
      {/* ── HEADER ── */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0, color: '#141414' }}>
            <AppstoreOutlined style={{ color: '#1890ff', marginRight: 12 }} /> 
            Gestionnaire des Lits
          </Title>
          <Text type="secondary" style={{ fontSize: 15 }}>Vue globale du taux d'occupation et gestion des transferts.</Text>
        </div>
        <Space>
          <Text strong>Filtrer par Pôle :</Text>
          <Select value={selectedDept} onChange={setSelectedDept} style={{ width: 200 }} size="large">
            <Option value="ALL">🌟 Tous les Pôles</Option>
            {departments.map(d => <Option key={d.id || d.name} value={d.name}>{d.name}</Option>)}
          </Select>
        </Space>
      </div>

      {/* ── KPI STATISTICS ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#fff', borderLeft: '5px solid #1890ff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Taux d'Occupation</Text>} value={occupancyRate} suffix="%" valueStyle={{ color: occupancyRate > 90 ? '#cf1322' : '#1890ff', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#fff', borderLeft: '5px solid #595959', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Capacité Totale (Lits)</Text>} value={totalBeds} valueStyle={{ color: '#595959', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#fff1f0', borderLeft: '5px solid #ff4d4f', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Lits Occupés</Text>} value={occupiedBedsCount} valueStyle={{ color: '#ff4d4f', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#f6ffed', borderLeft: '5px solid #52c41a', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Lits Disponibles</Text>} value={totalBeds - occupiedBedsCount} valueStyle={{ color: '#52c41a', fontWeight: 800 }} />
          </Card>
        </Col>
      </Row>

      {/* ── WARD MAP ── */}
      {displayedRooms.length === 0 ? (
        <Empty description="Aucune salle configurée pour l'hospitalisation. Veuillez configurer les paramètres système." style={{ marginTop: 50 }} />
      ) : (
        <Row gutter={[20, 20]}>
          {displayedRooms.map(room => {
            const capacity = parseInt(room.capacity) || 1;
            const beds = Array.from({ length: capacity }, (_, i) => i + 1);

            return (
              <Col span={24} md={12} lg={8} key={room.id || room.name}>
                <Card 
                  title={<span style={{ fontSize: 16 }}>{room.name}</span>} 
                  extra={<Tag color="purple" style={{ margin: 0 }}>{room.department}</Tag>}
                  style={{ borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
                  headStyle={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
                >
                  <Row gutter={[12, 12]}>
                    {beds.map(num => {
                      const bedLabel = `Lit ${num.toString().padStart(2, '0')}`;
                      const activeHosp = hospitalizations.find(h => h.room_name === room.name && h.bed_number === bedLabel);
                      
                      return (
                        <Col span={capacity > 1 ? 12 : 24} key={num}>
                          <Tooltip title={activeHosp ? `Gérer le lit de ${activeHosp.patient_name}` : `Installer un patient au ${bedLabel}`}>
                            <div 
                              onClick={() => handleBedClick(room, bedLabel, activeHosp)}
                              style={{ 
                                padding: '16px 12px', 
                                borderRadius: '10px', 
                                textAlign: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                border: `2px solid ${activeHosp ? '#ff7875' : '#95de64'}`,
                                backgroundColor: activeHosp ? '#fff1f0' : '#f6ffed',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                            >
                              <Text strong style={{ fontSize: 16, color: activeHosp ? '#cf1322' : '#389e0d' }}>{bedLabel}</Text>
                              <div style={{ marginTop: 8, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {activeHosp ? (
                                  <div>
                                    <UserOutlined style={{ color: '#cf1322', fontSize: 18, marginBottom: 4 }} /><br/>
                                    <Text strong style={{ color: '#cf1322', fontSize: 13, lineHeight: 1.1, display: 'block' }}>
                                      {activeHosp.patient_name.length > 15 ? activeHosp.patient_name.substring(0,15) + '...' : activeHosp.patient_name}
                                    </Text>
                                  </div>
                                ) : (
                                  <Text type="success" style={{ fontSize: '13px', fontWeight: 600 }}>Disponible</Text>
                                )}
                              </div>
                            </div>
                          </Tooltip>
                        </Col>
                      );
                    })}
                  </Row>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* ── MODAL: ADMIT PATIENT (Empty Bed) ── */}
      <Modal 
        title={<Space><CheckCircleOutlined style={{ color: '#52c41a' }}/> Installation Patient</Space>} 
        open={isAdmitModalOpen} 
        onOk={() => form.submit()} 
        onCancel={() => setIsAdmitModalOpen(false)}
        okText="Installer le patient"
        cancelText="Annuler"
      >
        <div style={{ background: '#f6ffed', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #b7eb8f' }}>
          <Text strong>Emplacement : </Text> {selectedBed?.room.department} &gt; {selectedBed?.room.name} &gt; {selectedBed?.bedName}
        </div>
        <Form form={form} layout="vertical" onFinish={handleAdmit}>
          <Form.Item name="patient_id" label="Sélectionner le Patient" rules={[{ required: true, message: 'Requis' }]}>
            <Select showSearch placeholder="Rechercher par nom..." size="large" filterOption={(input, option) => (option?.children ?? '').toLowerCase().includes(input.toLowerCase())}>
              {patients.map(p => <Option key={p.id} value={p.id}>{p.first_name} {p.last_name}</Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── MODAL: MANAGE OCCUPIED BED ── */}
      <Modal 
        title={<Space><UserOutlined style={{ color: '#1890ff' }}/> Gestion du Lit Occupé</Space>} 
        open={isOccupiedModalOpen} 
        onCancel={() => setIsOccupiedModalOpen(false)}
        footer={null}
      >
        {selectedBed?.activeHosp && (
          <div>
            <div style={{ background: '#e6f7ff', padding: 16, borderRadius: 8, marginBottom: 20, border: '1px solid #91d5ff' }}>
              <Title level={4} style={{ margin: '0 0 10px 0', color: '#0050b3' }}>{selectedBed.activeHosp.patient_name}</Title>
              <Text strong>Emplacement : </Text> {selectedBed.room.name} - {selectedBed.bedName}<br/>
              <Text strong>Admis le : </Text> {dayjs(selectedBed.activeHosp.admission_date).format('DD/MM/YYYY HH:mm')}<br/>
              <Text strong>Médecin : </Text> Dr. {selectedBed.activeHosp.doctor_name}
            </div>

            <Row gutter={16}>
              <Col span={12}>
                <Button 
                  type="primary" 
                  block 
                  size="large" 
                  icon={<SwapOutlined />} 
                  onClick={() => { setIsOccupiedModalOpen(false); setIsTransferModalOpen(true); }}
                >
                  Transférer le patient
                </Button>
              </Col>
              <Col span={12}>
                <Button 
                  danger 
                  block 
                  size="large" 
                  icon={<SafetyCertificateOutlined />} 
                  onClick={handleDischarge}
                >
                  Libérer le lit (Sortie)
                </Button>
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* ── MODAL: TRANSFER PATIENT ── */}
      <Modal 
        title={<Space><SwapOutlined style={{ color: '#fa8c16' }}/> Transférer le Patient</Space>} 
        open={isTransferModalOpen} 
        onOk={() => transferForm.submit()} 
        onCancel={() => { setIsTransferModalOpen(false); transferForm.resetFields(); }}
        okText="Valider le Transfert"
        cancelText="Annuler"
      >
        {selectedBed?.activeHosp && (
          <>
            <div style={{ background: '#fff7e6', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #ffd591' }}>
              <Text strong>Patient : </Text> {selectedBed.activeHosp.patient_name}<br/>
              <Text strong>Origine : </Text> {selectedBed.room.name} ({selectedBed.bedName})
            </div>
            <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
              <Form.Item name="new_room" label="Nouvelle Salle de Destination" rules={[{ required: true }]}>
                <Select placeholder="Choisir la salle cible" size="large">
                  {rooms.map(r => (
                    <Option key={`trans-${r.id || r.name}`} value={`${r.department}|${r.name}`}>
                      {r.department} - {r.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item name="new_bed" label="Nouveau Lit" rules={[{ required: true }]}>
                <Select placeholder="Sélectionnez d'abord une salle" size="large">
                  {renderTransferBedOptions()}
                </Select>
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

    </div>
  );
};

export default HospitalisationBeds;