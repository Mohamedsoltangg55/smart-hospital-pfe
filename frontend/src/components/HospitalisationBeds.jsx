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
      console.error("Beds loading error:", error);
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
        doctor_name: localStorage.getItem('username') || "Department Head"
      };
      await client.post('/hospitalizations/', payload);
      message.success("Patient admitted successfully!");
      setIsAdmitModalOpen(false);
      fetchData(); // Force refresh to ensure sync
    } catch (error) {
      message.error("Error during admission.");
    }
  };

  // --- DISCHARGE PATIENT ---
  const handleDischarge = () => {
    Modal.confirm({
      title: `Authorize discharge?`,
      content: `Do you really want to free ${selectedBed.activeHosp.patient_name}'s bed?`,
      okText: 'Yes, Discharge',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await client.patch(`/hospitalizations/${selectedBed.activeHosp.id}/discharge`, {
            doctor_name: localStorage.getItem('username') || "Administration"
          });
          message.success("Bed freed successfully.");
          setIsOccupiedModalOpen(false);
          fetchData();
        } catch (e) {
          console.error("Discharge error:", e.response || e);
          message.error("Discharge error: " + (e.response?.data?.detail || e.message));
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
      
      message.loading({ content: "Transfer in progress...", key: "transfer" });
      
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

      message.success({ content: "Patient transferred successfully!", key: "transfer", duration: 2 });
      setIsTransferModalOpen(false);
      setIsOccupiedModalOpen(false);
      fetchData();
    } catch (e) {
      message.error({ content: "Transfer failed.", key: "transfer" });
    }
  };

  const renderTransferBedOptions = () => {
    if (!selectedNewRoomValue) return <Option disabled>Please choose a room</Option>;
    
    const newRoomName = selectedNewRoomValue.split('|')[1];
    const targetRoom = rooms.find(r => r.name === newRoomName);
    if (!targetRoom) return [];

    const capacity = targetRoom.capacity || 1;
    const beds = [];

    for (let i = 1; i <= capacity; i++) {
      const bedName = `Bed ${i.toString().padStart(2, '0')}`;
      const isOccupied = hospitalizations.some(h => h.room_name === newRoomName && h.bed_number === bedName);
      if (!isOccupied) { // Only show empty beds for transfer!
        beds.push(<Option key={bedName} value={bedName}>{bedName} 🟢 (Free)</Option>);
      }
    }

    if (beds.length === 0) return <Option disabled>No free beds in this room</Option>;
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
            Bed Manager
          </Title>
          <Text type="secondary" style={{ fontSize: 15 }}>Global view of occupancy rate and transfer management.</Text>
        </div>
        <Space>
          <Text strong>Filter by Department:</Text>
          <Select value={selectedDept} onChange={setSelectedDept} style={{ width: 200 }} size="large">
            <Option value="ALL">🌟 All Departments</Option>
            {departments.map(d => <Option key={d.id || d.name} value={d.name}>{d.name}</Option>)}
          </Select>
        </Space>
      </div>

      {/* ── KPI STATISTICS ── */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#fff', borderLeft: '5px solid #1890ff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Occupancy Rate</Text>} value={occupancyRate} suffix="%" valueStyle={{ color: occupancyRate > 90 ? '#cf1322' : '#1890ff', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#fff', borderLeft: '5px solid #595959', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Total Capacity (Beds)</Text>} value={totalBeds} valueStyle={{ color: '#595959', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#fff1f0', borderLeft: '5px solid #ff4d4f', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Occupied Beds</Text>} value={occupiedBedsCount} valueStyle={{ color: '#ff4d4f', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ borderRadius: 12, background: '#f6ffed', borderLeft: '5px solid #52c41a', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Statistic title={<Text style={{ fontWeight: 600 }}>Available Beds</Text>} value={totalBeds - occupiedBedsCount} valueStyle={{ color: '#52c41a', fontWeight: 800 }} />
          </Card>
        </Col>
      </Row>

      {/* ── WARD MAP ── */}
      {displayedRooms.length === 0 ? (
        <Empty description="No rooms configured for hospitalization. Please configure system settings." style={{ marginTop: 50 }} />
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
                      const bedLabel = `Bed ${num.toString().padStart(2, '0')}`;
                      const activeHosp = hospitalizations.find(h => h.room_name === room.name && h.bed_number === bedLabel);
                      
                      return (
                        <Col span={capacity > 1 ? 12 : 24} key={num}>
                          <Tooltip title={activeHosp ? `Manage ${activeHosp.patient_name}'s bed` : `Admit a patient to ${bedLabel}`}>
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
                                  <Text type="success" style={{ fontSize: '13px', fontWeight: 600 }}>Available</Text>
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
        title={<Space><CheckCircleOutlined style={{ color: '#52c41a' }}/> Patient Admission</Space>}
        open={isAdmitModalOpen}
        onOk={() => form.submit()}
        onCancel={() => setIsAdmitModalOpen(false)}
        okText="Admit patient"
        cancelText="Cancel"
      >
        <div style={{ background: '#f6ffed', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #b7eb8f' }}>
          <Text strong>Location: </Text> {selectedBed?.room.department} &gt; {selectedBed?.room.name} &gt; {selectedBed?.bedName}
        </div>
        <Form form={form} layout="vertical" onFinish={handleAdmit}>
          <Form.Item name="patient_id" label="Select the Patient" rules={[{ required: true, message: 'Required' }]}>
            <Select showSearch placeholder="Search by name..." size="large" filterOption={(input, option) => (option?.children ?? '').toLowerCase().includes(input.toLowerCase())}>
              {patients.map(p => <Option key={p.id} value={p.id}>{p.first_name} {p.last_name}</Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── MODAL: MANAGE OCCUPIED BED ── */}
      <Modal 
        title={<Space><UserOutlined style={{ color: '#1890ff' }}/> Manage Occupied Bed</Space>}
        open={isOccupiedModalOpen}
        onCancel={() => setIsOccupiedModalOpen(false)}
        footer={null}
      >
        {selectedBed?.activeHosp && (
          <div>
            <div style={{ background: '#e6f7ff', padding: 16, borderRadius: 8, marginBottom: 20, border: '1px solid #91d5ff' }}>
              <Title level={4} style={{ margin: '0 0 10px 0', color: '#0050b3' }}>{selectedBed.activeHosp.patient_name}</Title>
              <Text strong>Location: </Text> {selectedBed.room.name} - {selectedBed.bedName}<br/>
              <Text strong>Admitted on: </Text> {dayjs(selectedBed.activeHosp.admission_date).format('DD/MM/YYYY HH:mm')}<br/>
              <Text strong>Doctor: </Text> Dr. {selectedBed.activeHosp.doctor_name}
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
                  Transfer the patient
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
                  Free the bed (Discharge)
                </Button>
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* ── MODAL: TRANSFER PATIENT ── */}
      <Modal 
        title={<Space><SwapOutlined style={{ color: '#fa8c16' }}/> Transfer the Patient</Space>}
        open={isTransferModalOpen}
        onOk={() => transferForm.submit()}
        onCancel={() => { setIsTransferModalOpen(false); transferForm.resetFields(); }}
        okText="Confirm Transfer"
        cancelText="Cancel"
      >
        {selectedBed?.activeHosp && (
          <>
            <div style={{ background: '#fff7e6', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #ffd591' }}>
              <Text strong>Patient: </Text> {selectedBed.activeHosp.patient_name}<br/>
              <Text strong>Origin: </Text> {selectedBed.room.name} ({selectedBed.bedName})
            </div>
            <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
              <Form.Item name="new_room" label="New Destination Room" rules={[{ required: true }]}>
                <Select placeholder="Choose the target room" size="large">
                  {rooms.map(r => (
                    <Option key={`trans-${r.id || r.name}`} value={`${r.department}|${r.name}`}>
                      {r.department} - {r.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item name="new_bed" label="New Bed" rules={[{ required: true }]}>
                <Select placeholder="Select a room first" size="large">
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